'use client'

import { useSyncExternalStore } from 'react'

/**
 * Shared ticking clock — one interval for the whole app, 10s granularity.
 * Drives live countdowns (see lib/liveTime) so every ArrivalCard on screen
 * ticks down together instead of waiting for the next network poll.
 *
 * The snapshot is quantised to the tick size so it stays referentially stable
 * between ticks (useSyncExternalStore re-renders only when it changes).
 */
const TICK_MS = 10_000

const listeners = new Set<() => void>()
let timer: ReturnType<typeof setInterval> | null = null

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (timer === null) {
    timer = setInterval(() => listeners.forEach(l => l()), TICK_MS)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

const getSnapshot = () => Math.floor(Date.now() / TICK_MS) * TICK_MS
// Server renders no live data (arrivals arrive via client-side SWR), so any
// stable value works here.
const getServerSnapshot = () => 0

/** Current time in ms, updating every 10s while mounted. */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
