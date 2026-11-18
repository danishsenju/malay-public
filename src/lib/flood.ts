// Shared types + constants for the Cuaca & Banjir feature. Client-safe - the
// server-side fetchers live in floodSource.ts / weatherSource.ts.

/** JPS's own four-step river classification, plus our two honesty states. */
export type FloodLevel =
  | 'normal'
  | 'alert'      // Waspada
  | 'warning'    // Amaran
  | 'danger'     // Bahaya
  | 'unverified' // JPS flags it, but the threshold is 0 - a config hole, not a flood
  | 'offline'    // station reports Error, or its last reading is too old to trust

export type RainClass = 'light' | 'moderate' | 'heavy' | 'very-heavy'

export type Trend = 'rising' | 'falling' | 'steady'

/** One JPS telemetry station, trimmed to what the page and alerts need. */
export interface FloodStation {
  id: string
  name: string
  lat: number
  lon: number
  district: string
  state: StateCode
  river: string
  /** null for rain-only gauges */
  level: FloodLevel | null
  waterLevelM: number | null
  /** The threshold JPS compared against for `level` (normal level when normal). */
  thresholdM: number | null
  trend: Trend | null
  /** ISO, null when the station has no water-level sensor */
  levelAt: string | null
  /** null when no fresh rain reading (or no gauge) */
  rain: RainClass | null
  rain1hMm: number | null
  rainTodayMm: number | null
  rainAt: string | null
}

export interface FloodFeed {
  /** Stations with something current to show: a live water level, or rain
   *  falling right now. Offline + dry rain-only gauges are left out of the
   *  payload (they'd double it) and only counted. */
  stations: FloodStation[]
  offlineByState: Partial<Record<StateCode, number>>
  /** Newest reading anywhere in the feed - JPS refreshes every 15 min. */
  sourceUpdatedAt: string | null
  stale: boolean
  message?: string
}

export interface ForecastDay {
  date: string // YYYY-MM-DD
  morning: string
  afternoon: string
  night: string
  summary: string
  when: string | null
  minC: number
  maxC: number
}

export interface MetWarning {
  issued: string
  titleMs: string
  titleEn: string
  validFrom: string | null
  validTo: string | null
  textMs: string
  textEn: string
}

export interface WeatherFeed {
  /** 7-day state-level forecasts keyed by our state code */
  forecast: Partial<Record<StateCode, ForecastDay[]>>
  warnings: MetWarning[]
  stale: boolean
}

// ── States ──────────────────────────────────────────────────────────────────
// One code system for both sources: JPS names states in upper case
// ("WILAYAH PERSEKUTUAN KUALA LUMPUR "), MET uses St001…St503 location ids.

export const STATES = [
  { code: 'PLS', name: 'Perlis',          short: 'Perlis',     jps: 'PERLIS',                            met: 'St001' },
  { code: 'KDH', name: 'Kedah',           short: 'Kedah',      jps: 'KEDAH',                             met: 'St002' },
  { code: 'PNG', name: 'Pulau Pinang',    short: 'Penang',     jps: 'PULAU PINANG',                      met: 'St003' },
  { code: 'PRK', name: 'Perak',           short: 'Perak',      jps: 'PERAK',                             met: 'St004' },
  { code: 'KEL', name: 'Kelantan',        short: 'Kelantan',   jps: 'KELANTAN',                          met: 'St005' },
  { code: 'TRG', name: 'Terengganu',      short: 'Terengganu', jps: 'TERENGGANU',                        met: 'St006' },
  { code: 'PHG', name: 'Pahang',          short: 'Pahang',     jps: 'PAHANG',                            met: 'St007' },
  { code: 'SEL', name: 'Selangor',        short: 'Selangor',   jps: 'SELANGOR',                          met: 'St008' },
  { code: 'WLH', name: 'Kuala Lumpur',    short: 'KL',         jps: 'WILAYAH PERSEKUTUAN KUALA LUMPUR',  met: 'St009' },
  { code: 'PTJ', name: 'Putrajaya',       short: 'Putrajaya',  jps: 'WILAYAH PERSEKUTUAN PUTRAJAYA',     met: 'St010' },
  { code: 'NSN', name: 'Negeri Sembilan', short: 'N. Sembilan', jps: 'NEGERI SEMBILAN',                  met: 'St011' },
  { code: 'MLK', name: 'Melaka',          short: 'Melaka',     jps: 'MELAKA',                            met: 'St012' },
  { code: 'JHR', name: 'Johor',           short: 'Johor',      jps: 'JOHOR',                             met: 'St013' },
  { code: 'SRK', name: 'Sarawak',         short: 'Sarawak',    jps: 'SARAWAK',                           met: 'St501' },
  { code: 'SAB', name: 'Sabah',           short: 'Sabah',      jps: 'SABAH',                             met: 'St502' },
  { code: 'WLP', name: 'Labuan',          short: 'Labuan',     jps: 'WILAYAH PERSEKUTUAN LABUAN',        met: 'St503' },
] as const

export type StateCode = (typeof STATES)[number]['code']

export const STATE_BY_CODE = new Map(STATES.map(s => [s.code, s]))

export function isStateCode(v: unknown): v is StateCode {
  return typeof v === 'string' && STATE_BY_CODE.has(v as StateCode)
}

// ── Severity ────────────────────────────────────────────────────────────────

/** Higher = worse. Used for sorting, escalation checks and the heat rings. */
export const LEVEL_RANK: Record<FloodLevel, number> = {
  offline: -1,
  unverified: -1,
  normal: 0,
  alert: 1,
  warning: 2,
  danger: 3,
}

export function isElevated(level: FloodLevel | null): level is 'alert' | 'warning' | 'danger' {
  return level === 'alert' || level === 'warning' || level === 'danger'
}

/**
 * Sticker colours per level - pulled straight from the poster palette (no new
 * hues): mustard for "watch", burnt orange (already the map palette's warm
 * accent) for "warning", maroon for "danger". Text inverts per fill luminance.
 */
export const LEVEL_STYLE: Record<FloodLevel, { bg: string; text: string }> = {
  danger:     { bg: '#780016', text: '#ffffff' },
  warning:    { bg: '#c1440e', text: '#ffffff' },
  alert:      { bg: '#d6a337', text: '#000000' },
  normal:     { bg: '#ffffff', text: '#000000' },
  unverified: { bg: '#e8efd6', text: '#676b5f' },
  offline:    { bg: '#adadad', text: '#000000' },
}

/** Rain gauges paint the cool side of the palette - cobalt, never warm. */
export const RAIN_STYLE: Record<RainClass, { fill: string; radiusM: number }> = {
  'light':      { fill: '#2665d6', radiusM: 3_000 },
  'moderate':   { fill: '#2665d6', radiusM: 5_000 },
  'heavy':      { fill: '#061492', radiusM: 7_500 },
  'very-heavy': { fill: '#061492', radiusM: 10_000 },
}

/** Malaysia, peninsula to Borneo - the default map frame. */
export const MALAYSIA_BOUNDS: [[number, number], [number, number]] = [[0.85, 99.6], [7.4, 119.3]]
