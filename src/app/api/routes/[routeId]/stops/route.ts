import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

// Returns the ordered stops (boarding / drop-off checkpoints) for a bus route,
// so the map can draw them as dots along the route line - the same affordance
// PULSE gives riders for "where exactly can I get off?".
//
// A route runs many trips with near-identical stop patterns, so one
// representative trip per direction is enough for checkpoints. Stops shared by
// both directions are deduped - the map only needs each physical stop once.

const ALLOWED = new Set([
  'rapid-bus-kl', 'rapid-rail-kl', 'ktmb', 'mybas-johor', 'rapid-bus-penang', 'rapid-bus-mrtfeeder',
  'mybas-alor-setar', 'mybas-kuala-terengganu', 'mybas-ipoh',
  'mybas-seremban-a', 'mybas-seremban-b', 'mybas-melaka', 'mybas-kuching',
])

interface TripRow { trip_id: string; direction_id: number | null }
interface StopTimeRow { trip_id: string; stop_id: string; stop_sequence: number }
interface StopRow { stop_id: string; stop_name: string; stop_lat: number; stop_lon: number }

export async function GET(
  request: Request,
  { params }: { params: Promise<{ routeId: string }> },
) {
  const { routeId } = await params
  const { searchParams } = new URL(request.url)
  const network = searchParams.get('network')?.trim() ?? 'rapid-bus-kl'

  if (!ALLOWED.has(network)) {
    return NextResponse.json(
      { error: `Unsupported network "${network}"` },
      { status: 400 },
    )
  }

  const db = getSupabaseAdmin()

  // A sample of this route's trips is plenty to find one per direction.
  const { data: trips, error: tripsErr } = await db
    .from('trip_route_map')
    .select('trip_id, direction_id')
    .eq('network', network)
    .eq('route_id', routeId)
    .limit(50)

  if (tripsErr) return NextResponse.json({ error: tripsErr.message }, { status: 500 })

  const byDirection = new Map<number, string>()
  for (const t of (trips ?? []) as TripRow[]) {
    const dir = t.direction_id ?? 0
    if (!byDirection.has(dir)) byDirection.set(dir, t.trip_id)
  }
  const tripIds = [...byDirection.values()]

  if (tripIds.length === 0) return NextResponse.json({ stops: [] })

  const { data: stopTimes, error: stErr } = await db
    .from('stop_times')
    .select('trip_id, stop_id, stop_sequence')
    .eq('network', network)
    .in('trip_id', tripIds)
    .order('trip_id')
    .order('stop_sequence')

  if (stErr) return NextResponse.json({ error: stErr.message }, { status: 500 })

  const stopIds = [...new Set(((stopTimes ?? []) as StopTimeRow[]).map(s => s.stop_id))]
  if (stopIds.length === 0) return NextResponse.json({ stops: [] })

  const { data: stops, error: stopsErr } = await db
    .from('stops')
    .select('stop_id, stop_name, stop_lat, stop_lon')
    .eq('network', network)
    .in('stop_id', stopIds)

  if (stopsErr) return NextResponse.json({ error: stopsErr.message }, { status: 500 })

  const byId = new Map(((stops ?? []) as StopRow[]).map(s => [s.stop_id, s]))

  // Preserve riding order (per direction, by stop_sequence), dedupe across
  // directions, and drop stop_times rows whose stop record is missing.
  const seen = new Set<string>()
  const out: StopRow[] = []
  for (const st of (stopTimes ?? []) as StopTimeRow[]) {
    if (seen.has(st.stop_id)) continue
    seen.add(st.stop_id)
    const s = byId.get(st.stop_id)
    if (s) out.push(s)
  }

  return NextResponse.json({ stops: out })
}
