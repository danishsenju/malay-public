import { getSupabaseAdmin } from './supabase'

/**
 * KTM line schedule summaries - read from the ingested GTFS static tables,
 * never fetched live per-request.
 *
 * IMPORTANT (see CLAUDE.md): the upstream endpoint
 *   GET https://api.data.gov.my/gtfs-static/ktmb
 * is NOT JSON - it 301/302-redirects to an S3 `.zip` of GTFS CSVs
 * (trips, routes, stops, stop_times, calendar, agency). Calling `.json()` on
 * it throws. That zip is parsed ONCE by `scripts/ingest-gtfs-static.ts` into
 * Supabase (network = 'ktmb'); everything here reads those tables.
 *
 * Each line's summary is derived from its trips' stop_times:
 *   - representative (longest) trip → origin, destination, station count
 *   - per-trip terminus departure → first train / last train / services per day
 * The schedule only changes when the timetable does, so results are cached hard.
 */

export interface KtmbLine {
  routeId: string
  name: string
  /** 'komuter' (route_type 0) or 'intercity' (route_type 2). */
  kind: 'komuter' | 'intercity'
  color: string      // hex, no '#'
  textColor: string  // hex, no '#'
  origin: string
  destination: string
  stationCount: number
  services: number
  firstTrain: string // "HH:MM" MYT
  lastTrain: string  // "HH:MM" MYT
  /** true when the last departure is a post-midnight service (GTFS 24:00+). */
  lastAfterMidnight: boolean
}

export interface KtmbScheduleResult {
  lines: KtmbLine[]
  /** 0 = never successfully loaded (empty cache and this load failed). */
  fetchedAt: number
  stale: boolean
  message?: string
}

// Fallback colours for intercity routes whose GTFS route_color is null -
// kept in sync with src/app/api/ktmb/lines/route.ts.
const FALLBACK_COLOR: Record<string, string> = {
  ETS: 'B58500',
  SH:  '8A5A2B',
  ERT: '6B21A8',
  ES:  '0F766E',
  ST:  '444444',
}

const REFRESH_MS = 6 * 60 * 60 * 1000 // schedule changes at most daily
const STOP_TIMES_CAP = 20_000         // safety cap per route query

let cache: { at: number; lines: KtmbLine[] } | null = null
let inflight: Promise<KtmbLine[]> | null = null

interface StopTimeRow {
  trip_id: string
  stop_id: string
  stop_sequence: number
  departure_time: string | null
}

/** "HH:MM:SS" (GTFS, may exceed 24h) → { hm: "HH:MM", plus: boolean }. */
function formatTime(raw: string): { hm: string; plus: boolean } {
  const [h = '00', m = '00'] = raw.split(':')
  let hh = parseInt(h, 10)
  const plus = hh >= 24
  if (plus) hh -= 24
  return { hm: `${String(hh).padStart(2, '0')}:${m}`, plus }
}

async function compute(): Promise<KtmbLine[]> {
  const db = getSupabaseAdmin()

  const [routesRes, trmRes, stopsRes] = await Promise.all([
    db.from('routes')
      .select('route_id, route_short_name, route_long_name, route_type, route_color, route_text_color')
      .eq('network', 'ktmb'),
    db.from('trip_route_map')
      .select('trip_id, route_id')
      .eq('network', 'ktmb'),
    db.from('stops')
      .select('stop_id, stop_name')
      .eq('network', 'ktmb')
      .limit(2000),
  ])
  if (routesRes.error) throw new Error(routesRes.error.message)
  if (trmRes.error) throw new Error(trmRes.error.message)
  if (stopsRes.error) throw new Error(stopsRes.error.message)

  const stopName = new Map<string, string>()
  for (const s of stopsRes.data ?? []) stopName.set(s.stop_id, s.stop_name)

  const tripsByRoute = new Map<string, string[]>()
  for (const r of trmRes.data ?? []) {
    let arr = tripsByRoute.get(r.route_id)
    if (!arr) { arr = []; tripsByRoute.set(r.route_id, arr) }
    arr.push(r.trip_id)
  }

  const lines: KtmbLine[] = []

  for (const route of routesRes.data ?? []) {
    const tripIds = tripsByRoute.get(route.route_id) ?? []
    if (tripIds.length === 0) continue // route with no ingested trips - no schedule to show

    const { data: st, error } = await db
      .from('stop_times')
      .select('trip_id, stop_id, stop_sequence, departure_time')
      .eq('network', 'ktmb')
      .in('trip_id', tripIds)
      .limit(STOP_TIMES_CAP)
    if (error) throw new Error(error.message)

    // Group rows by trip, ordered along the line.
    const byTrip = new Map<string, StopTimeRow[]>()
    for (const row of (st ?? []) as StopTimeRow[]) {
      let arr = byTrip.get(row.trip_id)
      if (!arr) { arr = []; byTrip.set(row.trip_id, arr) }
      arr.push(row)
    }
    if (byTrip.size === 0) continue
    for (const arr of byTrip.values()) arr.sort((a, b) => a.stop_sequence - b.stop_sequence)

    // Representative trip = the one that visits the most stops (fullest line).
    let longest: StopTimeRow[] = []
    // Terminus departures = each trip's first-stop departure time.
    const originDepartures: string[] = []
    for (const arr of byTrip.values()) {
      if (arr.length > longest.length) longest = arr
      const dep = arr[0]?.departure_time
      if (dep) originDepartures.push(dep)
    }
    if (longest.length < 2 || originDepartures.length === 0) continue

    originDepartures.sort() // GTFS times are zero-padded fixed-width - lexical sort is chronological
    const first = formatTime(originDepartures[0])
    const last = formatTime(originDepartures[originDepartures.length - 1])

    const kind: KtmbLine['kind'] = route.route_type === 2 ? 'intercity' : 'komuter'

    lines.push({
      routeId: route.route_id,
      name: route.route_short_name || route.route_long_name || route.route_id,
      kind,
      color: route.route_color || FALLBACK_COLOR[route.route_id] || '2665d6',
      textColor: route.route_text_color || 'FFFFFF',
      origin: stopName.get(longest[0].stop_id) ?? '-',
      destination: stopName.get(longest[longest.length - 1].stop_id) ?? '-',
      stationCount: longest.length,
      services: byTrip.size,
      firstTrain: first.hm,
      lastTrain: last.hm,
      lastAfterMidnight: last.plus,
    })
  }

  // Komuter lines first, then intercity; alphabetical within each group.
  lines.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'komuter' ? -1 : 1,
  )
  return lines
}

/**
 * Returns cached KTM line schedules, refreshing at most every 6h.
 * On upstream (Supabase) failure, falls back to the last good cache and marks
 * the result `stale` - never a broken empty state if we have anything to show.
 */
export async function getKtmbSchedule(): Promise<KtmbScheduleResult> {
  const now = Date.now()

  if (cache && now - cache.at < REFRESH_MS) {
    return { lines: cache.lines, fetchedAt: cache.at, stale: false }
  }

  if (!inflight) {
    inflight = compute().finally(() => { inflight = null })
  }

  try {
    const lines = await inflight
    cache = { at: now, lines }
    return { lines, fetchedAt: now, stale: false }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    if (cache) {
      const ageMin = Math.round((now - cache.at) / 60_000)
      return {
        lines: cache.lines,
        fetchedAt: cache.at,
        stale: true,
        message: `Jadual cache ${ageMin} min lalu - sumber tak dapat dicapai`,
      }
    }
    return { lines: [], fetchedAt: 0, stale: true, message: reason }
  }
}
