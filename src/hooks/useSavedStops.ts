'use client'

import { useCallback, useSyncExternalStore } from 'react'
import type { NearbyStop } from '@/lib/types'

const STORAGE_KEY = 'sampai-bila:saved'

// ── localStorage-backed store ─────────────────────────────────────────────────
// Read through useSyncExternalStore so hydration needs no setState-in-effect,
// and the 'storage' event keeps multiple tabs in sync.

const listeners = new Set<() => void>()
const EMPTY: NearbyStop[] = []
let cachedRaw: string | null = null
let cachedStops: NearbyStop[] = EMPTY

function getSnapshot(): NearbyStop[] {
  let raw: string | null = null
  try { raw = localStorage.getItem(STORAGE_KEY) } catch {}
  if (raw !== cachedRaw) {
    cachedRaw = raw
    try { cachedStops = raw ? (JSON.parse(raw) as NearbyStop[]) : EMPTY } catch { cachedStops = EMPTY }
  }
  return cachedStops
}

function getServerSnapshot(): NearbyStop[] {
  return EMPTY
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

function write(next: NearbyStop[]) {
  const raw = JSON.stringify(next)
  try { localStorage.setItem(STORAGE_KEY, raw) } catch {}
  cachedRaw = raw
  cachedStops = next
  listeners.forEach(l => l())
}

// `hydrated` flips to true on the first client render after hydration.
const emptySubscribe = () => () => {}
const getTrue = () => true
const getFalse = () => false

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useSavedStops() {
  const saved = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
  const hydrated = useSyncExternalStore(emptySubscribe, getTrue, getFalse)

  const save = useCallback((stop: NearbyStop) => {
    const current = getSnapshot()
    if (current.some(s => s.stop_id === stop.stop_id && s.network === stop.network)) return
    // Strip distance_m — not meaningful once saved out of proximity context
    const rest = { ...stop }
    delete rest.distance_m
    write([...current, rest])
  }, [])

  const remove = useCallback((stop: NearbyStop) => {
    write(getSnapshot().filter(
      s => !(s.stop_id === stop.stop_id && s.network === stop.network)
    ))
  }, [])

  const isSaved = useCallback(
    (stop: NearbyStop) =>
      saved.some(s => s.stop_id === stop.stop_id && s.network === stop.network),
    [saved],
  )

  return { saved, save, remove, isSaved, hydrated }
}
