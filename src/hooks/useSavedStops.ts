'use client'

import { useCallback, useEffect, useState } from 'react'
import type { NearbyStop } from '@/lib/types'

const STORAGE_KEY = 'sampai-bila:saved'

export function useSavedStops() {
  const [saved, setSaved] = useState<NearbyStop[]>([])
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setSaved(JSON.parse(raw))
    } catch {}
    setHydrated(true)
  }, [])

  const save = useCallback((stop: NearbyStop) => {
    setSaved(prev => {
      if (prev.some(s => s.stop_id === stop.stop_id && s.network === stop.network)) return prev
      // Strip distance_m — not meaningful once saved out of proximity context
      const { distance_m: _dist, ...rest } = stop
      const next = [...prev, rest]
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  const remove = useCallback((stop: NearbyStop) => {
    setSaved(prev => {
      const next = prev.filter(
        s => !(s.stop_id === stop.stop_id && s.network === stop.network)
      )
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [])

  const isSaved = useCallback(
    (stop: NearbyStop) =>
      saved.some(s => s.stop_id === stop.stop_id && s.network === stop.network),
    [saved],
  )

  return { saved, save, remove, isSaved, hydrated }
}
