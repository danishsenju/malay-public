import { STATES, type FloodFeed, type FloodLevel, type FloodStation, type RainClass, type StateCode, type Trend } from './flood'

/**
 * JPS Public InfoBanjir - live river levels + rain gauges for every state.
 *
 * Source: the JSON file JPS's own station map loads
 *   https://publicinfobanjir.water.gov.my/wp-content/themes/enlighten/data/latestreadingstrendabc.json
 * Undocumented but public (found 2026-11-18 by reading their map's $.getJSON
 * calls). ~2,700 stations, ~1.3 MB, refreshed every 15 min at the source.
 * We use it instead of data.gov.my's /flood-warning, whose data stopped
 * updating on 2024-02-23.
 *
 * Keys are single letters. Decoded by cross-checking against JPS's HTML
 * tables (aras-air-data):
 *   a id · b name · c lat · d lon · e district · f state · g river · i sensors
 *   m water level (m) · n JPS status · o threshold behind that status · s trend
 *   q water-level time · u rain last 1h (mm) · v rain today (mm) · x rain class
 *   y rain time · -9999 = no reading
 */

const JPS_URL =
  'https://publicinfobanjir.water.gov.my/wp-content/themes/enlighten/data/latestreadingstrendabc.json'

const CACHE_TTL_MS = 5 * 60_000      // source refreshes every 15 min
const FETCH_TIMEOUT_MS = 15_000      // 1.3 MB from a government host
const MAX_READING_AGE_MS = 3 * 3600_000 // older than this = offline, never "current"

interface JpsRow {
  a: string; b: string; c: string; d: string; e: string; f: string; g: string; i: string
  m: string; n: string; o: string; q: string; s: string
  u: string; v: string; x: string; y: string
}

const STATE_BY_JPS = new Map<string, StateCode>(STATES.map(s => [s.jps, s.code]))

function num(v: string | undefined): number | null {
  if (v == null || v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n > -9000 ? n : null
}

/** "18/11/2026 11:15" in MYT (UTC+8, no DST) → epoch ms. */
function parseMyt(v: string | undefined): number | null {
  const m = (v ?? '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2})/)
  if (!m) return null
  return Date.UTC(+m[3], +m[2] - 1, +m[1], +m[4] - 8, +m[5])
}

const JPS_LEVEL: Record<string, FloodLevel> = {
  Normal: 'normal',
  Alert: 'alert',
  Warning: 'warning',
  Danger: 'danger',
  Error: 'offline',
}

const JPS_RAIN: Record<string, RainClass> = {
  'Light': 'light',
  'Moderate': 'moderate',
  'Heavy': 'heavy',
  'Very Heavy': 'very-heavy',
}

const JPS_TREND: Record<string, Trend> = {
  Rising: 'rising',
  Receding: 'falling',
  'No Change': 'steady',
}

function toStation(r: JpsRow, now: number): FloodStation | null {
  const state = STATE_BY_JPS.get((r.f ?? '').trim().toUpperCase())
  const lat = num(r.c)
  const lon = num(r.d)
  if (!state || lat == null || lon == null || (lat === 0 && lon === 0)) return null

  // ── Water level ──
  const hasWl = /WL/.test(r.i ?? '')
  const levelTs = parseMyt(r.q)
  const wl = num(r.m)
  const threshold = num(r.o)
  let level: FloodLevel | null = null
  if (hasWl) {
    const fresh = levelTs != null && now - levelTs <= MAX_READING_AGE_MS
    level = !fresh || wl == null ? 'offline' : JPS_LEVEL[r.n] ?? 'offline'
    // Honesty guard: a dozen Sabah "(F2)" stations report Danger against a
    // threshold of exactly 0 - a missing config value at JPS, not a flood.
    // Show them, never alarm on them.
    if ((level === 'alert' || level === 'warning' || level === 'danger') && threshold === 0) {
      level = 'unverified'
    }
  }

  // ── Rain ──
  const rainTs = parseMyt(r.y)
  const rainFresh = rainTs != null && now - rainTs <= MAX_READING_AGE_MS
  const rain = rainFresh ? JPS_RAIN[r.x] ?? null : null

  return {
    id: r.a.trim(),
    name: r.b.trim(),
    lat,
    lon,
    district: (r.e ?? '').trim(),
    state,
    river: (r.g ?? '').trim(),
    level,
    waterLevelM: hasWl ? wl : null,
    thresholdM: hasWl ? threshold : null,
    trend: hasWl ? JPS_TREND[r.s] ?? null : null,
    levelAt: hasWl && levelTs != null ? new Date(levelTs).toISOString() : null,
    rain,
    rain1hMm: rainFresh ? num(r.u) : null,
    rainTodayMm: rainFresh ? num(r.v) : null,
    rainAt: rainFresh && rainTs != null ? new Date(rainTs).toISOString() : null,
  }
}

function parse(rows: JpsRow[]): Omit<FloodFeed, 'stale'> {
  const now = Date.now()
  const seen = new Set<string>()
  const stations: FloodStation[] = []
  const offlineByState: FloodFeed['offlineByState'] = {}
  let newest = 0
  for (const r of rows) {
    const s = toStation(r, now)
    if (!s || seen.has(s.id)) continue
    seen.add(s.id)
    for (const ts of [s.levelAt, s.rainAt]) {
      if (ts) newest = Math.max(newest, Date.parse(ts))
    }
    // Only ship what the page draws: a live river, or rain falling now. A dry
    // rain gauge or a dead sensor is a number, not a dot - ~60% of the feed.
    if (s.level === 'offline') offlineByState[s.state] = (offlineByState[s.state] ?? 0) + 1
    if ((s.level != null && s.level !== 'offline') || s.rain != null) stations.push(s)
  }
  return { stations, offlineByState, sourceUpdatedAt: newest ? new Date(newest).toISOString() : null }
}

// ── Cache (same shape as gtfsRealtime's: TTL, in-flight dedupe, stale fallback)

let cache: { feed: Omit<FloodFeed, 'stale'>; fetchedAt: number } | null = null
let inflight: Promise<FloodFeed> | null = null

async function doFetch(): Promise<FloodFeed> {
  try {
    const res = await fetch(JPS_URL, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
      headers: { 'User-Agent': 'TransitMY/1.0 (+public transit & flood info)' },
    })
    if (!res.ok) throw new Error(`JPS ${res.status}`)
    const rows = (await res.json()) as JpsRow[]
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('JPS returned no stations')
    const feed = parse(rows)
    cache = { feed, fetchedAt: Date.now() }
    return { ...feed, stale: false }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    if (cache) return { ...cache.feed, stale: true, message: `JPS unreachable - showing last copy (${reason})` }
    return { stations: [], offlineByState: {}, sourceUpdatedAt: null, stale: true, message: `JPS unreachable - ${reason}` }
  }
}

export async function fetchFloodFeed(): Promise<FloodFeed> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return { ...cache.feed, stale: false }
  if (inflight) return inflight
  inflight = doFetch().finally(() => { inflight = null })
  return inflight
}
