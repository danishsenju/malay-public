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
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** serviceWorker.ready never settles if registration failed - don't hang the toggle. */
function swReady(): Promise<ServiceWorkerRegistration> {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('sw-timeout')), 8_000)),
  ])
}

async function postSubscription(sub: PushSubscription, states: StateCode[], lang: Lang, confirm: boolean) {
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON(), states, lang, confirm }),
  })
  if (res.status === 503) throw new Error('not-configured')
  if (!res.ok) throw new Error('subscribe-failed')
  return (await res.json()) as { confirmed?: boolean }
}

export interface FloodAlerts {
  support: PushSupport
  /** null until the browser has told us */
  enabled: boolean | null
  states: StateCode[]
  busy: boolean
  /** One-line feedback after an action (success or failure). */
  notice: { key: StringKey; tone: 'ok' | 'error' } | null
  enable: (states: StateCode[]) => Promise<void>
  disable: () => Promise<void>
  setStates: (states: StateCode[]) => Promise<void>
}

export function useFloodAlerts(lang: Lang): FloodAlerts {
  const support = useSyncExternalStore(emptySubscribe, getSupport, getServerSupport)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [states, setStatesState] = useState<StateCode[]>([])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<FloodAlerts['notice']>(null)

  // Hydrate from the browser - all setState calls land in async callbacks.
  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => {
      if (!cancelled) setStatesState(readStates())
    })
    if (support !== 'supported') return () => { cancelled = true }
    swReady()
      .then(reg => reg.pushManager.getSubscription())
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
    try {
      // First await in the tap handler: iOS only shows the permission sheet
      // when it's requested straight from a user gesture.
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setNotice({ key: 'alerts.denied', tone: 'error' })
        return
      }
      const reg = await swReady()
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }))
      const { confirmed } = await postSubscription(sub, picked, lang, true)
      writeStates(picked)
      setStatesState(picked)
      setEnabled(true)
      setNotice(confirmed ? { key: 'alerts.confirmSent', tone: 'ok' } : null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setNotice({ key: msg === 'not-configured' ? 'alerts.notConfigured' : 'alerts.failed', tone: 'error' })
    } finally {
      setBusy(false)
    }
  }, [lang])

  const disable = useCallback(async () => {
    setBusy(true)
    setNotice(null)
    try {
      const reg = await swReady()
      const sub = await reg.pushManager.getSubscription()
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
    } catch {
      setNotice({ key: 'alerts.failed', tone: 'error' })
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
      const reg = await swReady()
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        await postSubscription(sub, next, lang, false)
        setNotice({ key: 'alerts.saved', tone: 'ok' })
      }
    } catch {
      setNotice({ key: 'alerts.failed', tone: 'error' })
    }
  }, [enabled, lang])

  return { support, enabled, states, busy, notice, enable, disable, setStates }
}
