'use client'

import useSWR from 'swr'
import type { VehicleFeedResponse } from '@/lib/types'

async function fetchFeed(url: string): Promise<VehicleFeedResponse> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.json() as Promise<VehicleFeedResponse>
}

export function useRealtimeVehicles() {
  const { data: busData }  = useSWR<VehicleFeedResponse>('/api/vehicles/bus?category=rapid-bus-kl', fetchFeed, { refreshInterval: 15_000, revalidateOnFocus: false })
  const { data: ktmbData } = useSWR<VehicleFeedResponse>('/api/vehicles/ktmb',                      fetchFeed, { refreshInterval: 15_000, revalidateOnFocus: false })

  return {
    hasLiveBus:  (busData?.vehicles.length  ?? 0) > 0 && !busData?.stale,
    hasLiveKtmb: (ktmbData?.vehicles.length ?? 0) > 0 && !ktmbData?.stale,
    busStale:    busData?.stale  ?? false,
    ktmbStale:   ktmbData?.stale ?? false,
  }
}
