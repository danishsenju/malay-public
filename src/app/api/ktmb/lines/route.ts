import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import KTMB_SHAPES from '@/data/ktmbShapes.json'

/**
 * KTM line geometry for the live map. The KTMB GTFS feed ships no shapes.txt,
 * so real track polylines are prebuilt from OpenStreetMap railway data by
 * scripts/build-ktmb-shapes.mjs (Dijkstra along the actual rails between each
 * route's stations) and shipped as src/data/ktmbShapes.json. Routes missing
 * from that file fall back to station-to-station chords derived from the
 * longest trip, so a brand-new route still draws before the script is re-run.
 *
 * Geometry only changes when the timetable changes, so it's cached hard.
 */

interface LinePath {
  route_id: string
  name: string
  color: string
  path: [number, number][]
}

// Fallback colours for routes whose GTFS route_color is null (intercity).
const FALLBACK_COLOR: Record<string, string> = {
  ETS: 'B58500',
  SH:  '8A5A2B',
  ERT: '6B21A8',
  ES:  '0F766E',
  ST:  '444444',
}

const REFRESH_MS = 24 * 60 * 60 * 1000
// Wide sample — short workings (e.g. Batu Caves–KL only) are common early in
// the trip list, and we want the trip that covers the whole line.
const TRIP_SAMPLE = 30

let cache: { at: number; lines: LinePath[] } | null = null
let inflight: Promise<LinePath[]> | null = null

async function compute(): Promise<LinePath[]> {
  const db = getSupabaseAdmin()

  const [routesRes, trmRes, stopsRes] = await Promise.all([
    db.from('routes')
      .select('route_id, route_short_name, route_long_name, route_color')
      .eq('network', 'ktmb'),
    db.from('trip_route_map')
      .select('trip_id, route_id')
      .eq('network', 'ktmb'),
    db.from('stops')
      .select('stop_id, stop_lat, stop_lon')
      .eq('network', 'ktmb')
      .limit(1000),
  ])
  if (routesRes.error) throw new Error(routesRes.error.message)
  if (trmRes.error) throw new Error(trmRes.error.message)
  if (stopsRes.error) throw new Error(stopsRes.error.message)

  const coords = new Map<string, [number, number]>()
  for (const s of stopsRes.data ?? []) coords.set(s.stop_id, [s.stop_lat, s.stop_lon])

  const tripsByRoute = new Map<string, string[]>()
  for (const r of trmRes.data ?? []) {
    let arr = tripsByRoute.get(r.route_id)
    if (!arr) { arr = []; tripsByRoute.set(r.route_id, arr) }
    arr.push(r.trip_id)
  }

  const lines: LinePath[] = []
  for (const route of routesRes.data ?? []) {
    const tripIds = (tripsByRoute.get(route.route_id) ?? []).slice(0, TRIP_SAMPLE)
    if (tripIds.length === 0) continue

    const { data: stopTimes, error } = await db
      .from('stop_times')
      .select('trip_id, stop_id, stop_sequence')
      .eq('network', 'ktmb')
      .in('trip_id', tripIds)
      .order('trip_id')
      .order('stop_sequence')
      .limit(4000)
    if (error) throw new Error(error.message)

    // Longest sampled trip = fullest picture of the line.
    const byTrip = new Map<string, { stop_id: string; stop_sequence: number }[]>()
    for (const st of stopTimes ?? []) {
      let arr = byTrip.get(st.trip_id)
      if (!arr) { arr = []; byTrip.set(st.trip_id, arr) }
      arr.push(st)
    }
    let best: { stop_id: string; stop_sequence: number }[] = []
    for (const arr of byTrip.values()) {
      if (arr.length > best.length) best = arr
    }

    // Real OSM track geometry when prebuilt; chord fallback otherwise.
    // JSON import types as number[][]; the builder writes [lat, lon] pairs.
    const shape = (KTMB_SHAPES as unknown as Record<string, [number, number][]>)[route.route_id]
    const path = shape ?? best
      .map(st => coords.get(st.stop_id))
      .filter((p): p is [number, number] => p !== undefined)
    if (path.length < 2) continue

    lines.push({
      route_id: route.route_id,
      name: route.route_long_name ?? route.route_short_name ?? route.route_id,
      color: route.route_color ?? FALLBACK_COLOR[route.route_id] ?? '2665d6',
      path,
    })
  }

  return lines
}

export async function GET() {
  try {
    if (!cache || Date.now() - cache.at > REFRESH_MS) {
      if (!inflight) {
        inflight = compute().finally(() => { inflight = null })
      }
      cache = { at: Date.now(), lines: await inflight }
    }
    return NextResponse.json({ lines: cache.lines }, {
      headers: { 'Cache-Control': 's-maxage=86400, stale-while-revalidate=604800' },
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'ktmb lines failed' },
      { status: 500 },
    )
  }
}
