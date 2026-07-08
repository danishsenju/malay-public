'use client'

import { useEffect, useState } from 'react'

// KL Sentral — shown while geolocation is pending or denied.
const DEFAULT_LAT = 3.1343
const DEFAULT_LON = 101.6865

export interface GeolocationResult {
  lat:       number
  lon:       number
  /** true while geolocation hasn't resolved yet (or was denied) */
  isDefault: boolean
  /** true while the browser prompt is still pending */
  isPending: boolean
}

export function useGeolocation(): GeolocationResult {
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [isPending, setIsPending] = useState(true)

  useEffect(() => {
    if (!navigator?.geolocation) {
      setIsPending(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      pos => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setIsPending(false)
      },
      () => {
        // Denied or timed out — fall through to default silently.
        setIsPending(false)
      },
      { timeout: 8_000, maximumAge: 60_000 },
    )
  }, [])

  return {
    lat:       coords?.lat ?? DEFAULT_LAT,
    lon:       coords?.lon ?? DEFAULT_LON,
    isDefault: coords === null,
    isPending,
  }
}
