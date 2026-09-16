'use client'

import useSWR from 'swr'
import { getSupabase } from '@/lib/supabase'
import type { Network } from '@/lib/types'

/** Row returned by the last_departures() Supabase RPC. */
export interface LastDeparture {
  route_id:         string
  route_short_name: string | null
  route_color:      string | null
  route_text_color: string | null
  trip_headsign:    string | null
  direction_id:     number | null
  last_time:        string   // "HH:MM" MYT
  last_secs:        number
}

async function fetchLastDepartures(stopId: string, network: Network): Promise<LastDeparture[]> {
  const { data, error } = await getSupabase().rpc('last_departures', {
    p_stop_id: stopId,
    p_network: network,
  })
  if (error) throw error
  return (data ?? []) as LastDeparture[]
}

/**
 * Last Train Guardian - the last scheduled service tonight at a stop.
 * Schedule data only changes daily, so refresh lazily.
 */
export function useLastTrain(stopId: string, network: Network) {
  const { data, error, isLoading } = useSWR(
    `last_departures:${stopId}:${network}`,
    () => fetchLastDepartures(stopId, network),
    { refreshInterval: 10 * 60_000, revalidateOnFocus: false },
  )
  return { lastDepartures: (data ?? []) as LastDeparture[], isLoading, error: error as Error | null }
}
