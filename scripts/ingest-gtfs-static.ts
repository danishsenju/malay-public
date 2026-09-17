/**
 * TransitMY - GTFS static ingestion
 *
 * Downloads GTFS static ZIP files from data.gov.my, parses them, and upserts
 * data into Supabase. Safe to re-run - all operations are upserts.
 *
 * Usage:
 *   npm run ingest                                      # all three networks
 *   npm run ingest -- ktmb                              # one network only
 *   npm run ingest -- rapid-rail-kl rapid-bus-kl        # two networks
 *   npm run ingest -- --no-stop-times                   # skip stop_times (faster)
 *   npm run ingest -- rapid-bus-kl --no-stop-times      # bus stops/routes only
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * After running, populate the geography index once in Supabase SQL editor:
 *   UPDATE stops
 *   SET location = ST_SetSRID(ST_MakePoint(stop_lon, stop_lat), 4326)::geography;
 */

// dotenv must load before any module reads process.env at call-time
import * as dotenv from 'dotenv'
import * as path from 'path'
dotenv.config({ path: path.join(process.cwd(), '.env.local') })

import AdmZip from 'adm-zip'
import { parse as csvParse } from 'csv-parse/sync'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import ws from 'ws'

// ── Feed registry ──────────────────────────────────────────────────────────────

const FEEDS = {
  'rapid-rail-kl':          'https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl',
  'rapid-bus-kl':           'https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-kl',
  'ktmb':                   'https://api.data.gov.my/gtfs-static/ktmb',
  'mybas-johor':            'https://api.data.gov.my/gtfs-static/mybas-johor',
  // Same Prasarana endpoint, different categories - `rapid-bus-kuantan` is
  // documented by data.gov.my but returns 404 (checked 2026-09-18: the API's
  // own error message lists valid categories and Kuantan isn't one), so it's
  // deliberately not included here.
  'rapid-bus-penang':       'https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-penang',
  'rapid-bus-mrtfeeder':    'https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-mrtfeeder',
  // BAS.MY city feeds. mybas-kangar and mybas-kota-bharu also exist but ship
  // only CSV headers with zero actual rows (checked 2026-09-18) - not
  // included until the operators (Mara Liner, Konsortium E-Mutiara) publish
  // real data.
  'mybas-alor-setar':       'https://api.data.gov.my/gtfs-static/mybas-alor-setar',
  'mybas-kuala-terengganu': 'https://api.data.gov.my/gtfs-static/mybas-kuala-terengganu',
  'mybas-ipoh':             'https://api.data.gov.my/gtfs-static/mybas-ipoh',
  'mybas-seremban-a':       'https://api.data.gov.my/gtfs-static/mybas-seremban-a',
  'mybas-seremban-b':       'https://api.data.gov.my/gtfs-static/mybas-seremban-b',
  'mybas-melaka':           'https://api.data.gov.my/gtfs-static/mybas-melaka',
  'mybas-kuching':          'https://api.data.gov.my/gtfs-static/mybas-kuching',
} as const

type Network = keyof typeof FEEDS

// KTMB realtime→static tripId mismatch (train service numbers "50","51" vs.
// GTFS numeric ids "26","2900"…) is resolved at the UI layer: KTMB vehicles
// always render a hardcoded "KTM" badge; trip_route_map is still ingested for
// the departure board (upcoming_arrivals needs route info from the static GTFS).

// KTMB is a purely fixed-schedule network (no frequencies.txt).
// mybas-johor ships stop_times but no frequencies.txt either — every trip
// runs on a single "ALLDAY" calendar service (verified in trips.txt), so it
// needs no calendar filter in upcoming_arrivals, same as KTMB.
// rapid-rail-kl (100%) and rapid-bus-kl (99.9%) are frequency-based.
// None of the 9 networks below ship frequencies.txt either - they're all
// fixed-schedule via stop_times, but (unlike Johor) with REAL calendar.txt
// day-of-week variety, handled by upcoming_arrivals' generic calendar
// fallback (see supabase/phase6-more-networks.sql) rather than a shortcut.
const SKIP_FREQUENCIES = new Set<Network>([
  'ktmb', 'mybas-johor',
  'rapid-bus-penang', 'rapid-bus-mrtfeeder',
  'mybas-alor-setar', 'mybas-kuala-terengganu', 'mybas-ipoh',
  'mybas-seremban-a', 'mybas-seremban-b', 'mybas-melaka', 'mybas-kuching',
])

const BATCH = 500   // rows per Supabase upsert call
const TIMEOUT = 30_000  // ms for ZIP download

// ── CSV / ZIP helpers ──────────────────────────────────────────────────────────

function parseCsv<T extends Record<string, string>>(buf: Buffer): T[] {
  return csvParse(buf, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,  // some GTFS files include a UTF-8 BOM
  }) as T[]
}

function readEntry(zip: AdmZip, filename: string): Buffer | null {
  const entry = zip.getEntry(filename)
  return entry ? entry.getData() : null
}

async function downloadZip(url: string): Promise<AdmZip> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) })
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length === 0) throw new Error(`Empty response - feed may be offline`)
  console.log(`  Downloaded ${(buf.length / 1_024).toFixed(0)} KB`)
  return new AdmZip(buf)
}

// ── Supabase upsert with progress ─────────────────────────────────────────────

async function upsertBatched(
  db: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  conflict: string,
  label: string,
): Promise<void> {
  if (rows.length === 0) {
    console.log(`  ${label}: 0 rows, skipping`)
    return
  }
  let done = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const { error } = await db.from(table).upsert(batch, { onConflict: conflict })
    if (error) throw new Error(`${table} upsert at row ${i}: ${error.message}`)
    done += batch.length
    process.stdout.write(`\r  ${label}: ${done.toLocaleString()} / ${rows.length.toLocaleString()}`)
  }
  console.log()  // newline after inline progress
}

// ── Per-entity ingesters ──────────────────────────────────────────────────────

async function ingestStops(zip: AdmZip, network: Network, db: SupabaseClient) {
  const buf = readEntry(zip, 'stops.txt')
  if (!buf) { console.warn('  ⚠ stops.txt not found'); return }

  const raw = parseCsv<{ stop_id: string; stop_name: string; stop_lat: string; stop_lon: string }>(buf)

  const rows = raw
    .filter(r => r.stop_id && r.stop_lat && r.stop_lon)
    .map(r => ({
      stop_id:   r.stop_id,
      network,
      stop_name: r.stop_name,
      stop_lat:  parseFloat(r.stop_lat),
      stop_lon:  parseFloat(r.stop_lon),
      // location (GEOGRAPHY) is set post-ingestion via the SQL printed at end of script
    }))

  await upsertBatched(db, 'stops', rows, 'stop_id,network', 'stops')
}

async function ingestRoutes(zip: AdmZip, network: Network, db: SupabaseClient) {
  const buf = readEntry(zip, 'routes.txt')
  if (!buf) { console.warn('  ⚠ routes.txt not found'); return }

  const raw = parseCsv<{
    route_id: string
    route_short_name: string
    route_long_name: string
    route_type: string
    route_color: string
    route_text_color: string
  }>(buf)

  const rows = raw
    .filter(r => r.route_id)
    .map(r => ({
      route_id:         r.route_id,
      network,
      route_short_name: r.route_short_name  || null,
      route_long_name:  r.route_long_name   || null,
      route_type:       parseInt(r.route_type, 10),
      route_color:      r.route_color       || null,
      route_text_color: r.route_text_color  || null,
    }))

  await upsertBatched(db, 'routes', rows, 'route_id,network', 'routes')
}

async function ingestTripRouteMap(zip: AdmZip, network: Network, db: SupabaseClient) {
  const buf = readEntry(zip, 'trips.txt')
  if (!buf) { console.warn('  ⚠ trips.txt not found'); return }

  const raw = parseCsv<{
    trip_id: string
    route_id: string
    trip_headsign: string
    direction_id: string
    shape_id: string
    service_id: string
  }>(buf)

  const rows = raw
    .filter(r => r.trip_id && r.route_id)
    .map(r => ({
      trip_id:       r.trip_id,
      network,
      route_id:      r.route_id,
      trip_headsign: r.trip_headsign || null,
      direction_id:  r.direction_id !== '' ? parseInt(r.direction_id, 10) : null,
      shape_id:      r.shape_id     || null,
      // Only meaningful for networks with a real GTFS calendar (see the
      // `calendar` table + upcoming_arrivals' generic fallback branch) -
      // ktmb/rapid-rail-kl/rapid-bus-kl/mybas-johor filter by trip_id
      // pattern instead and never read this column.
      service_id:    r.service_id   || null,
    }))

  await upsertBatched(db, 'trip_route_map', rows, 'trip_id,network', 'trip_route_map')
}

// Rapid Penang and MRT Feeder's own routes.txt just repeats the route number
// as route_long_name (or, for MRT Feeder, omits route_short_name and uses a
// bare code like "T107" as route_long_name) - no rider-facing "from - to"
// text at all, unlike every other network here. trips.txt's trip_headsign
// DOES carry that text (e.g. "JETI - BATU MAUNG"), just in shouty caps, so
// backfill route_long_name from a representative headsign wherever the
// route's own long name isn't actually descriptive.
function looksLikeBareCode(s: string): boolean {
  return !/[\s\-~]/.test(s.trim())
}

function needsBetterLongName(short: string | null, long: string | null): boolean {
  if (!long || long.trim() === '') return true
  if (short && long.trim().toUpperCase() === short.trim().toUpperCase()) return true
  return looksLikeBareCode(long)
}

const KEEP_UPPER = new Set(['MRT', 'LRT', 'BRT', 'KTM', 'KTMB', 'KL', 'JB', 'KLIA', 'TBS'])

function formatHeadsign(raw: string): string {
  return raw
    .split(' ')
    .map(word => {
      if (word === '') return word
      const upper = word.toUpperCase()
      if (KEEP_UPPER.has(upper)) return upper
      if (/^[0-9]+$/.test(word)) return word
      if (word.includes('-')) {
        return word.split('-').map(w => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w)).join('-')
      }
      return word[0].toUpperCase() + word.slice(1).toLowerCase()
    })
    .join(' ')
}

async function enrichRouteLongNames(network: Network, db: SupabaseClient) {
  const { data: routes, error: rErr } = await db
    .from('routes')
    .select('route_id, route_short_name, route_long_name')
    .eq('network', network)
  if (rErr || !routes) return

  const rows = routes as { route_id: string; route_short_name: string | null; route_long_name: string | null }[]
  const needsFix = rows.filter(r => needsBetterLongName(r.route_short_name, r.route_long_name))
  if (needsFix.length === 0) return

  // One targeted query per route (not a bulk .in() fetch) - PostgREST caps a
  // single response at 1,000 rows by default, and a bulk fetch across dozens
  // of routes' full trip lists blows straight past that, silently starving
  // whichever route_ids didn't make the first page.
  let fixed = 0
  await Promise.all(
    needsFix.map(async r => {
      const { data } = await db
        .from('trip_route_map')
        .select('trip_headsign')
        .eq('network', network)
        .eq('route_id', r.route_id)
        .not('trip_headsign', 'is', null)
        .limit(1)
        .maybeSingle()
      const headsign = (data as { trip_headsign: string } | null)?.trip_headsign
      if (!headsign) return
      await db.from('routes')
        .update({ route_long_name: formatHeadsign(headsign) })
        .eq('route_id', r.route_id)
        .eq('network', network)
      fixed++
    }),
  )
  console.log(`  route names: backfilled ${fixed} / ${needsFix.length} from trip_headsign`)
}

async function ingestCalendar(zip: AdmZip, network: Network, db: SupabaseClient) {
  const buf = readEntry(zip, 'calendar.txt')
  if (!buf) { console.log('  calendar.txt not present, skipping'); return }

  const raw = parseCsv<{
    service_id: string
    monday: string; tuesday: string; wednesday: string; thursday: string
    friday: string; saturday: string; sunday: string
    start_date: string; end_date: string
  }>(buf)

  const toDate = (yyyymmdd: string) =>
    `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`

  const rows = raw
    .filter(r => r.service_id && r.start_date && r.end_date)
    .map(r => ({
      service_id: r.service_id,
      network,
      monday:     parseInt(r.monday, 10),
      tuesday:    parseInt(r.tuesday, 10),
      wednesday:  parseInt(r.wednesday, 10),
      thursday:   parseInt(r.thursday, 10),
      friday:     parseInt(r.friday, 10),
      saturday:   parseInt(r.saturday, 10),
      sunday:     parseInt(r.sunday, 10),
      start_date: toDate(r.start_date),
      end_date:   toDate(r.end_date),
    }))

  await upsertBatched(db, 'calendar', rows, 'service_id,network', 'calendar')
}

async function ingestShapes(zip: AdmZip, network: Network, db: SupabaseClient) {
  const buf = readEntry(zip, 'shapes.txt')
  if (!buf) { console.log('  shapes.txt not present, skipping'); return }

  const raw = parseCsv<{
    shape_id: string
    shape_pt_lat: string
    shape_pt_lon: string
    shape_pt_sequence: string
  }>(buf)

  const rows = raw
    .filter(r => r.shape_id && r.shape_pt_lat && r.shape_pt_lon)
    .map(r => ({
      shape_id: r.shape_id,
      network,
      sequence: parseInt(r.shape_pt_sequence, 10),
      lat:      parseFloat(r.shape_pt_lat),
      lon:      parseFloat(r.shape_pt_lon),
    }))

  await upsertBatched(db, 'shapes', rows, 'shape_id,network,sequence', 'shapes')
}

async function ingestFrequencies(zip: AdmZip, network: Network, db: SupabaseClient) {
  const buf = readEntry(zip, 'frequencies.txt')
  if (!buf) { console.log('  frequencies.txt not present, skipping'); return }

  const raw = parseCsv<{
    trip_id: string
    start_time: string
    end_time: string
    headway_secs: string
    exact_times: string
  }>(buf)

  const rows = raw
    .filter(r => r.trip_id && r.start_time && r.end_time && r.headway_secs)
    .map(r => ({
      trip_id:      r.trip_id,
      network,
      start_time:   r.start_time,
      end_time:     r.end_time,
      headway_secs: parseInt(r.headway_secs, 10),
      exact_times:  parseInt(r.exact_times || '0', 10),
    }))

  await upsertBatched(db, 'frequencies', rows, 'trip_id,network,start_time', 'frequencies')
}

async function ingestStopTimes(zip: AdmZip, network: Network, db: SupabaseClient) {
  const buf = readEntry(zip, 'stop_times.txt')
  if (!buf) { console.warn('  ⚠ stop_times.txt not found'); return }

  const raw = parseCsv<{
    trip_id: string
    stop_id: string
    stop_sequence: string
    arrival_time: string
    departure_time: string
  }>(buf)

  const rows = raw
    .filter(r => r.trip_id && r.stop_id && r.stop_sequence)
    .map(r => ({
      trip_id:        r.trip_id,
      network,
      stop_sequence:  parseInt(r.stop_sequence, 10),
      stop_id:        r.stop_id,
      arrival_time:   r.arrival_time,
      departure_time: r.departure_time,
    }))

  await upsertBatched(db, 'stop_times', rows, 'trip_id,network,stop_sequence', 'stop_times')
}

// ── Network orchestration ─────────────────────────────────────────────────────

async function ingestNetwork(
  network: Network,
  skipStopTimes: boolean,
  db: SupabaseClient,
): Promise<void> {
  const url = FEEDS[network]
  console.log(`\n▶ ${network}`)
  console.log(`  ${url}`)

  const zip = await downloadZip(url)
  const files = zip.getEntries().map(e => e.entryName).join(', ')
  console.log(`  ZIP: ${files}`)

  // Ingest in FK-safe order: routes before trip_route_map
  await ingestStops(zip, network, db)
  await ingestRoutes(zip, network, db)
  await ingestCalendar(zip, network, db)
  await ingestTripRouteMap(zip, network, db)
  await enrichRouteLongNames(network, db)
  await ingestShapes(zip, network, db)

  if (skipStopTimes) {
    console.log('  stop_times: skipped (--no-stop-times)')
    console.log('  frequencies: skipped (--no-stop-times)')
  } else {
    await ingestStopTimes(zip, network, db)
    if (SKIP_FREQUENCIES.has(network)) {
      console.log(`  frequencies: not applicable - ${network} is fixed-schedule`)
    } else {
      await ingestFrequencies(zip, network, db)
    }
  }
}

// ── CLI ───────────────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2)
  const skipStopTimes = argv.includes('--no-stop-times')
  const networkArgs   = argv.filter(a => !a.startsWith('--'))

  const allNetworks = Object.keys(FEEDS) as Network[]
  const targets: Network[] =
    networkArgs.length > 0
      ? networkArgs.filter((n): n is Network => n in FEEDS)
      : allNetworks

  if (targets.length === 0) {
    console.error(`No valid networks. Options: ${allNetworks.join(', ')}`)
    process.exit(1)
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }

  // Node 20 lacks native WebSocket - supply ws for Supabase's realtime layer
  // (the ingestion script never opens realtime channels, but createClient still initialises it)
  // Node 20 lacks native WebSocket - supply ws so createClient doesn't throw.
  // The ingestion script never opens realtime channels; this is purely to satisfy the init check.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createClient(supabaseUrl, serviceKey, { realtime: { transport: ws as any } })

  console.log('TransitMY - GTFS static ingestion')
  console.log(`Networks : ${targets.join(', ')}`)
  if (skipStopTimes) console.log('Flags    : --no-stop-times')

  const failed: Array<{ network: Network; message: string }> = []

  for (const network of targets) {
    try {
      await ingestNetwork(network, skipStopTimes, db)
      console.log(`  ✓ ${network} done`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`\n  ✗ ${network}: ${msg}`)
      failed.push({ network, message: msg })
    }
  }

  console.log('\n' + '─'.repeat(60))

  if (failed.length > 0) {
    console.error(`✗ ${failed.length} network(s) failed:`)
    failed.forEach(f => console.error(`  ${f.network}: ${f.message}`))
    process.exit(1)
  }

  console.log('✓ All networks ingested.\n')
  console.log('Next step - run this SQL once in Supabase to populate the')
  console.log('geography index (required for "nearby stops" queries):\n')
  console.log('  UPDATE stops')
  console.log('  SET location = ST_SetSRID(ST_MakePoint(stop_lon, stop_lat), 4326)::geography;\n')
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
