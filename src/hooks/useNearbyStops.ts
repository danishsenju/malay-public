'use client'

import useSWR from 'swr'
import { getSupabase } from '@/lib/supabase'
import type { NearbyStop } from '@/lib/types'

// Escalating search rings — keep growing until SOMETHING is found, so a user
// far from any stop still learns which public transport is nearest to them
// (and how far it is) instead of hitting a dead "none within 1.5 km" wall.
const RADII = [500, 1000, 1500, 3000, 5000, 10_000, 20_000] as const

interface NearbyResult {
  stops: NearbyStop[]
  radiusUsed: number
}

async function fetchNearbyStops(lat: number, lon: number): Promise<NearbyResult> {
  for (const radius of RADII) {
    const { data, error } = await getSupabase().rpc('nearby_stops', {
      p_lat:      lat,
      p_lon:      lon,
      p_radius_m: radius,
      p_limit:    6,
    })
    if (error) throw error
    const stops = (data ?? []) as NearbyStop[]
    if (stops.length > 0) return { stops, radiusUsed: radius }
  }
  return { stops: [], radiusUsed: RADII[RADII.length - 1] }
}

export function useNearbyStops(lat: number, lon: number) {
  const key = `nearby_stops:${lat.toFixed(5)}:${lon.toFixed(5)}`
  const { data, error, isLoading } = useSWR(
    key,
    () => fetchNearbyStops(lat, lon),
    { refreshInterval: 60_000, revalidateOnFocus: true },
  )
  return {
    stops:      data?.stops      ?? [],
    radiusUsed: data?.radiusUsed ?? RADII[0],
    isLoading,
    error: error as Error | null,
  }
}
