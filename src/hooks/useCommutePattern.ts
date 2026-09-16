'use client'

import { useCallback, useSyncExternalStore } from 'react'
import type { NearbyStop } from '@/lib/types'

/**
 * Smart Commute - learns the rider's routine ENTIRELY on-device.
 *
 * Every stop the user opens is counted into a (daypart × weekday/weekend)
 * slot in localStorage. When the same slot recurs often enough, the home
 * screen surfaces that stop before the user searches for it. Nothing is
 * ever sent to a server - privacy is the feature.
 *
 * Implemented as a tiny external store + useSyncExternalStore, so the
 * localStorage read is hydration-safe (server snapshot is null) without
 * setState-in-effect churn.
 */

const STORAGE_KEY = 'sb:commute:v1'
const MIN_VISITS = 3   // a routine, not a coincidence
const MAX_ENTRIES = 40 // keep the store tiny; prune the least-recent

type Daypart = 'pagi' | 'tengahari' | 'petang' | 'malam'

export interface SlotEntry {
  stop:   NearbyStop
  count:  number
  lastAt: number
}

type Store = Record<string, SlotEntry> // key: `${daypart}|${daytype}|${network}|${stop_id}`

function daypartFor(h: number): Daypart {
  if (h >= 5 && h < 11) return 'pagi'
  if (h >= 11 && h < 16) return 'tengahari'
  if (h >= 16 && h < 21) return 'petang'
  return 'malam'
}

function slotNow(): { daypart: Daypart; daytype: 'wd' | 'we' } {
  const d = new Date()
  return {
    daypart: daypartFor(d.getHours()),
    daytype: d.getDay() === 0 || d.getDay() === 6 ? 'we' : 'wd',
  }
}

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Store) : {}
  } catch {
    return {}
  }
}

function writeStore(store: Store) {
  try {
    const entries = Object.entries(store)
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => b[1].lastAt - a[1].lastAt)
      store = Object.fromEntries(entries.slice(0, MAX_ENTRIES))
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Storage full or blocked - the routine just won't be learned. Fine.
  }
}

function computePrediction(): SlotEntry | null {
  const { daypart, daytype } = slotNow()
  const prefix = `${daypart}|${daytype}|`
  let best: SlotEntry | null = null
  for (const [key, entry] of Object.entries(readStore())) {
    if (!key.startsWith(prefix)) continue
    if (entry.count < MIN_VISITS) continue
    if (!best || entry.count > best.count) best = entry
  }
  return best
}

// ── Tiny external store ──────────────────────────────────────────────────────

let cachedPrediction: SlotEntry | null = null
let initialized = false
const listeners = new Set<() => void>()

function getSnapshot(): SlotEntry | null {
  if (!initialized && typeof window !== 'undefined') {
    initialized = true
    cachedPrediction = computePrediction()
  }
  return cachedPrediction
}

function getServerSnapshot(): SlotEntry | null {
  return null
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function emit() {
  cachedPrediction = computePrediction()
  for (const l of listeners) l()
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useCommutePattern() {
  const prediction = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const recordVisit = useCallback((stop: NearbyStop) => {
    const { daypart, daytype } = slotNow()
    const key = `${daypart}|${daytype}|${stop.network}|${stop.stop_id}`
    const store = readStore()
    const prev = store[key]
    store[key] = {
      stop:   { stop_id: stop.stop_id, stop_name: stop.stop_name, network: stop.network, stop_lat: stop.stop_lat, stop_lon: stop.stop_lon },
      count:  (prev?.count ?? 0) + 1,
      lastAt: Date.now(),
    }
    writeStore(store)
    emit()
  }, [])

  return { prediction, recordVisit }
}
