'use client'

import useSWR from 'swr'
import { getSupabase } from '@/lib/supabase'
import type { Arrival, Network } from '@/lib/types'

async function fetchArrivals(stopId: string, network: Network): Promise<Arrival[]> {
  const { data, error } = await getSupabase().rpc('upcoming_arrivals', {
    p_stop_id:   stopId,
    p_network:   network,
    p_ahead_min: 90,
  })
  if (error) throw error
  return (data ?? []) as Arrival[]
}

export function useUpcomingArrivals(stopId: string, network: Network) {
  const key = `upcoming_arrivals:${stopId}:${network}`
  const { data, error, isLoading } = useSWR(
    key,
    () => fetchArrivals(stopId, network),
    // revalidateOnFocus matters here: SWR pauses refreshInterval while the tab
    // is hidden, so returning to the app must trigger an immediate refetch or
    // the board shows minutes-old data.
    { refreshInterval: 20_000, revalidateOnFocus: true, keepPreviousData: true },
  )
  return { arrivals: (data ?? []) as Arrival[], isLoading, error: error as Error | null }
}
