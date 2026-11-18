'use client'

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { isStateCode, type StateCode } from '@/lib/flood'
import type { StringKey } from '@/lib/strings'
import type { Lang } from '@/lib/i18n'

/**
 * Flood push alerts, client side. Web Push is the one API that reaches both
 * Android (any Chromium/Firefox) and iPhone - with Apple's catch that iOS only
 * exposes PushManager to a PWA launched from the Home Screen (16.4+). So
 * "support" is a three-way answer, and the iOS-in-Safari case gets an
 * install nudge instead of a dead toggle.
 *
 * The truth about "am I subscribed?" lives in the browser (pushManager), not
 * localStorage - storage only remembers which states the rider picked.
 *
 * Failures are never lumped into one "try again": every stage that can break
 * (permission → service worker → push service → our server → the test push)
 * reports its own message AND a short technical `detail`, so a rider can read
 * the reason off the screen instead of guessing.
 */

export type PushSupport = 'pending' | 'supported' | 'ios-needs-install' | 'unsupported' | 'not-configured'

const STATES_KEY = 'transitmy:flood-states'
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''

function detectSupport(): PushSupport {
  const ua = navigator.userAgent
  const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  const hasApis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  if (ios && !standalone) return 'ios-needs-install'
  if (!hasApis) return 'unsupported'
  if (!VAPID_PUBLIC_KEY) return 'not-configured'
  return 'supported'
}

// Browser-only facts, read once through useSyncExternalStore (same pattern as
// InstallPrompt's eligibility) so SSR renders 'pending' with no mismatch.
let cachedSupport: PushSupport | null = null
const getSupport = () => (cachedSupport ??= detectSupport())
const getServerSupport = (): PushSupport => 'pending'
const emptySubscribe = () => () => {}

function readStates(): StateCode[] {
  try {
    const raw = JSON.parse(localStorage.getItem(STATES_KEY) ?? '[]')
    return Array.isArray(raw) ? raw.filter(isStateCode) : []
  } catch {
    return []
  }
}

function writeStates(states: StateCode[]) {
  try { localStorage.setItem(STATES_KEY, JSON.stringify(states)) } catch {}
}

/** VAPID keys travel as URL-safe base64; PushManager wants raw bytes. */
function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64.trim() + '='.repeat((4 - (base64.trim().length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

// ── Failure reporting ───────────────────────────────────────────────────────

type Notice = { key: StringKey; tone: 'ok' | 'error'; detail?: string }

/** Thrown inside enable(); carries the message to show plus a technical code. */
class AlertError extends Error {
  constructor(public key: StringKey, public detail?: string) {
    super(detail ?? key)
  }
}

function errName(err: unknown): string {
  return err instanceof Error ? (err.name !== 'Error' ? err.name : err.message) : String(err)
}

// ── Service worker ──────────────────────────────────────────────────────────

function waitActivated(worker: ServiceWorker, ms = 8_000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (worker.state === 'activated') return resolve()
    const timer = setTimeout(() => reject(new Error('sw-timeout')), ms)
    worker.addEventListener('statechange', () => {
      if (worker.state === 'activated') { clearTimeout(timer); resolve() }
      else if (worker.state === 'redundant') { clearTimeout(timer); reject(new Error('sw-redundant')) }
    })
  })
}

/**
 * An ACTIVE service worker registration, or a precise reason there isn't one.
 * `navigator.serviceWorker.ready` is the obvious call but it never settles when
 * registration failed or the install is stuck - the toggle just sat there and
 * finally timed out with no explanation. This registers if needed, waits for
 * activation with a clear failure, and nudges an update so an old worker
 * without the push handler is replaced before we subscribe.
 */
async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
  let reg = await navigator.serviceWorker.getRegistration('/')
  if (!reg) reg = await navigator.serviceWorker.register('/sw.js')
  await reg.update().catch(() => {})
  const pending = reg.installing ?? reg.waiting
  if (pending) await waitActivated(pending)
  else if (!reg.active) throw new Error('sw-no-worker')
  return reg
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration('/')
  return reg ? reg.pushManager.getSubscription() : null
}

function sameKey(sub: PushSubscription, key: Uint8Array<ArrayBuffer>): boolean {
  const have = sub.options?.applicationServerKey
  if (!have) return false
  const a = new Uint8Array(have)
  return a.length === key.length && a.every((v, i) => v === key[i])
}

/** Subscribe, replacing any leftover subscription made with a different VAPID
 *  key - the push service would reject our pushes against it with a 403. */
async function subscribeToPush(reg: ServiceWorkerRegistration): Promise<PushSubscription> {
  const key = keyBytes(VAPID_PUBLIC_KEY)
  const existing = await reg.pushManager.getSubscription()
  if (existing && sameKey(existing, key)) return existing
  if (existing) await existing.unsubscribe().catch(() => {})
  try {
    return await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
  } catch (err) {
    const name = errName(err)
    if (name === 'NotAllowedError') throw new AlertError('alerts.denied', name)
    // Chrome-family: the browser couldn't reach Google's push service (Brave
    // has "Use Google services for push messaging" OFF by default; some
    // networks/VPNs block fcm.googleapis.com).
    if (name === 'AbortError') throw new AlertError('alerts.err.pushService', name)
    if (name === 'InvalidAccessError' || name === 'InvalidCharacterError' || err instanceof TypeError) {
      throw new AlertError('alerts.err.key', `${name} · key length ${key.length}`)
    }
    throw new AlertError('alerts.err.subscribe', name)
  }
}

interface SubscribeResponse {
  ok?: boolean
  error?: string
  detail?: string
  confirmed?: { ok: boolean; status?: number | null; reason?: string }
}

async function postSubscription(sub: PushSubscription, states: StateCode[], lang: Lang, confirm: boolean): Promise<SubscribeResponse> {
  let res: Response
  try {
    res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON(), states, lang, confirm }),
    })
  } catch {
    throw new AlertError('alerts.err.network', 'fetch failed')
  }
  const body = (await res.json().catch(() => ({}))) as SubscribeResponse
  if (res.ok) return body
  const detail = [`HTTP ${res.status}`, body.error, body.detail].filter(Boolean).join(' · ')
  if (res.status === 503) throw new AlertError('alerts.notConfigured', detail)
  if (res.status === 400) throw new AlertError('alerts.err.endpoint', detail)
  if (res.status === 500) throw new AlertError('alerts.err.db', detail)
  throw new AlertError('alerts.failed', detail)
}

/** What the push service said when OUR server tried the test notification. */
function confirmFailure(c: NonNullable<SubscribeResponse['confirmed']>): Notice {
  const status = c.status ?? null
  const detail = `push ${status ?? 'no response'}${c.reason ? ` · ${c.reason.slice(0, 120)}` : ''}`
  // 401/403: the push service doesn't accept our VAPID signature - the public
  // and private key aren't a pair, the private key is wrong, or the subject is
  // unacceptable (Apple rejects localhost).
  if (status === 401 || status === 403) return { key: 'alerts.err.vapid', tone: 'error', detail }
  if (status === 404 || status === 410) return { key: 'alerts.err.gone', tone: 'error', detail }
  return { key: 'alerts.err.confirm', tone: 'error', detail }
}

export interface FloodAlerts {
  support: PushSupport
  /** null until the browser has told us */
  enabled: boolean | null
  states: StateCode[]
  busy: boolean
  /** One-line feedback after an action (success or failure). */
  notice: Notice | null
  enable: (states: StateCode[]) => Promise<void>
  disable: () => Promise<void>
  setStates: (states: StateCode[]) => Promise<void>
}

export function useFloodAlerts(lang: Lang): FloodAlerts {
  const support = useSyncExternalStore(emptySubscribe, getSupport, getServerSupport)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [states, setStatesState] = useState<StateCode[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)

  // Hydrate from the browser - all setState calls land in async callbacks.
  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (!cancelled) setStatesState(readStates())
    })
    if (support !== 'supported') return () => { cancelled = true }
    // getRegistration (not .ready): resolves right away even when no service
    // worker exists yet, so the switch never hangs disabled.
    currentSubscription()
      .then(sub => {
        if (!cancelled) setEnabled(sub !== null && Notification.permission === 'granted')
      })
      .catch(() => {
        if (!cancelled) setEnabled(false)
      })
    return () => { cancelled = true }
  }, [support])

  const enable = useCallback(async (picked: StateCode[]) => {
    if (picked.length === 0) {
      setNotice({ key: 'alerts.pickAtLeast', tone: 'error' })
      return
    }
    setBusy(true)
    setNotice(null)
    // Which stage we're in, so an unexpected throw still says where it broke.
    let stage = 'permission'
    try {
      // First await in the tap handler: iOS only shows the permission sheet
      // when it's requested straight from a user gesture.
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') throw new AlertError('alerts.denied', `permission: ${permission}`)

      stage = 'service-worker'
      let reg: ServiceWorkerRegistration
      try {
        reg = await ensureRegistration()
      } catch (err) {
        throw new AlertError('alerts.err.sw', errName(err))
      }

      stage = 'subscribe'
      const sub = await subscribeToPush(reg)

      stage = 'server'
      const res = await postSubscription(sub, picked, lang, true)
      writeStates(picked)
      setStatesState(picked)
      setEnabled(true)

      // Subscribed and saved - but did the test notification actually leave?
      if (!res.confirmed) setNotice(null)
      else if (res.confirmed.ok) setNotice({ key: 'alerts.confirmSent', tone: 'ok' })
      else setNotice(confirmFailure(res.confirmed))
    } catch (err) {
      if (err instanceof AlertError) {
        setNotice({ key: err.key, tone: 'error', detail: err.detail })
      } else {
        setNotice({ key: 'alerts.failed', tone: 'error', detail: `${stage}: ${errName(err)}` })
      }
    } finally {
      setBusy(false)
    }
  }, [lang])

  const disable = useCallback(async () => {
    setBusy(true)
    setNotice(null)
    try {
      const sub = await currentSubscription()
      if (sub) {
        // Server first: if the network call fails we still unsubscribe locally,
        // and the next push to the dead endpoint 410s and cleans itself up.
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {})
        await sub.unsubscribe()
      }
      setEnabled(false)
    } catch (err) {
      setNotice({ key: 'alerts.failed', tone: 'error', detail: `unsubscribe: ${errName(err)}` })
    } finally {
      setBusy(false)
    }
  }, [])

  const setStates = useCallback(async (next: StateCode[]) => {
    setStatesState(next)
    writeStates(next)
    setNotice(null)
    if (!enabled || next.length === 0) return
    try {
      const sub = await currentSubscription()
      if (sub) {
        await postSubscription(sub, next, lang, false)
        setNotice({ key: 'alerts.saved', tone: 'ok' })
      }
    } catch (err) {
      setNotice(err instanceof AlertError
        ? { key: err.key, tone: 'error', detail: err.detail }
        : { key: 'alerts.failed', tone: 'error', detail: errName(err) })
    }
  }, [enabled, lang])

  return { support, enabled, states, busy, notice, enable, disable, setStates }
}
