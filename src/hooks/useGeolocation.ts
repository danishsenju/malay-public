'use client'

import { useCallback, useEffect, useState } from 'react'

// KL Sentral — shown while geolocation is pending or denied.
const DEFAULT_LAT = 3.1343
const DEFAULT_LON = 101.6865

export type GeoStatus = 'pending' | 'located' | 'denied' | 'unavailable'

export interface GeolocationResult {
  lat:       number
  lon:       number
  /** true while geolocation hasn't resolved yet (or was denied) */
  isDefault: boolean
  /** true while a position request is in flight */
  isPending: boolean
  status:    GeoStatus
  /** Re-request the CURRENT position (maximumAge 0, high accuracy) — wired to
   *  the "detect my location" buttons so the user can force a fresh fix. */
  refresh:   () => void
}

export function useGeolocation(): GeolocationResult {
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [status, setStatus] = useState<GeoStatus>('pending')
  const [isPending, setIsPending] = useState(true)

  // All state updates happen inside the (async) geolocation callbacks — never
  // synchronously in an effect body.
  const request = useCallback((options: PositionOptions) => {
    navigator.geolocation.getCurrentPosition(
      pos => {
        setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude })
        setStatus('located')
        setIsPending(false)
      },
      err => {
        setStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable')
        setIsPending(false)
      },
      options,
    )
  }, [])

  useEffect(() => {
    // No geolocation API — resolve on the next tick, matching the async shape
    // of the supported path.
    if (!navigator?.geolocation) {
      const id = window.setTimeout(() => {
        setStatus('unavailable')
        setIsPending(false)
      }, 0)
      return () => window.clearTimeout(id)
    }
    // isPending starts true, so no state change is needed before requesting.
    request({ timeout: 8_000, maximumAge: 60_000 })
  }, [request])

  const refresh = useCallback(() => {
    if (!navigator?.geolocation) return
    setIsPending(true)
    request({ timeout: 12_000, maximumAge: 0, enableHighAccuracy: true })
  }, [request])

  return {
    lat:       coords?.lat ?? DEFAULT_LAT,
    lon:       coords?.lon ?? DEFAULT_LON,
    isDefault: coords === null,
    isPending,
    status,
    refresh,
  }
}
