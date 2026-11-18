import { STATES, type ForecastDay, type MetWarning, type StateCode, type WeatherFeed } from './flood'

/**
 * MET Malaysia via data.gov.my (JSON, no auth - unlike the GTFS feeds, these
 * really are JSON). Trailing slashes matter: without them the API 301s.
 *   /weather/forecast/  7-day forecast; St001…St503 are the 16 state ids
 *   /weather/warning/   thunderstorm / heavy rain / wind & sea / cyclone notices
 */

const FORECAST_URL = 'https://api.data.gov.my/weather/forecast/?contains=St@location__location_id&limit=200'
const WARNING_URL = 'https://api.data.gov.my/weather/warning/?limit=30'

const CACHE_TTL_MS = 10 * 60_000
const FETCH_TIMEOUT_MS = 8_000
const UNDATED_WARNING_TTL_MS = 12 * 3600_000

const STATE_BY_MET = new Map<string, StateCode>(STATES.map(s => [s.met, s.code]))

interface RawForecast {
  location: { location_id: string }
  date: string
  morning_forecast: string
  afternoon_forecast: string
  night_forecast: string
  summary_forecast: string
  summary_when: string | null
  min_temp: number
  max_temp: number
}

interface RawWarning {
  warning_issue: { issued: string; title_bm: string; title_en: string }
  valid_from: string | null
  valid_to: string | null
  text_bm: string | null
  text_en: string | null
}

/** MET timestamps carry no zone; they are MYT. */
function mytMs(v: string | null): number | null {
  if (!v) return null
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? v : `${v}+08:00`)
  return Number.isFinite(t) ? t : null
}

function todayMyt(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
}

function parseForecast(rows: RawForecast[]): WeatherFeed['forecast'] {
  const today = todayMyt()
  const out: WeatherFeed['forecast'] = {}
  for (const r of rows) {
    const code = STATE_BY_MET.get(r.location?.location_id)
    if (!code || r.date < today) continue
    const day: ForecastDay = {
      date: r.date,
      morning: r.morning_forecast,
      afternoon: r.afternoon_forecast,
      night: r.night_forecast,
      summary: r.summary_forecast,
      when: r.summary_when,
      minC: r.min_temp,
      maxC: r.max_temp,
    }
    ;(out[code] ??= []).push(day)
  }
  for (const days of Object.values(out)) days?.sort((a, b) => a.date.localeCompare(b.date))
  return out
}

function parseWarnings(rows: RawWarning[]): MetWarning[] {
  const now = Date.now()
  const seen = new Set<string>()
  const out: MetWarning[] = []
  const newestFirst = [...rows].sort((a, b) => (b.warning_issue?.issued ?? '').localeCompare(a.warning_issue?.issued ?? ''))
  for (const r of newestFirst) {
    const title = r.warning_issue?.title_en ?? ''
    // "No Advisory" is MET saying nothing is happening - not a warning.
    if (/no advisory/i.test(title)) continue
    const issued = mytMs(r.warning_issue.issued)
    const to = mytMs(r.valid_to)
    const active = to != null ? to >= now : issued != null && now - issued <= UNDATED_WARNING_TTL_MS
    if (!active) continue
    // MET re-issues the same bulletin with a shifted start but the same end -
    // newest first, so the first one kept is the latest issue.
    const key = `${title}|${r.valid_to}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({
      issued: new Date(issued ?? now).toISOString(),
      titleMs: r.warning_issue.title_bm,
      titleEn: r.warning_issue.title_en,
      validFrom: r.valid_from ? new Date(mytMs(r.valid_from)!).toISOString() : null,
      validTo: to != null ? new Date(to).toISOString() : null,
      textMs: (r.text_bm ?? '').trim(),
      textEn: (r.text_en ?? '').trim(),
    })
  }
  // MET can publish ONE bulletin as several records with different validity
  // windows (e.g. ending 18 Nov 14:00 and 23 Nov) but identical text - the text
  // itself carries each section's own period. Show it once, with the latest end.
  const byText = new Map<string, MetWarning>()
  for (const w of out) {
    const key = (w.textMs || w.textEn).replace(/\s+/g, ' ').trim() || `${w.titleMs}|${w.validTo}`
    const cur = byText.get(key)
    if (!cur || (w.validTo ?? '') > (cur.validTo ?? '')) byText.set(key, w)
  }
  return [...byText.values()].sort((a, b) => b.issued.localeCompare(a.issued)).slice(0, 8)
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), cache: 'no-store' })
  if (!res.ok) throw new Error(`data.gov.my ${res.status}`)
  return res.json() as Promise<T>
}

let cache: { feed: Omit<WeatherFeed, 'stale'>; fetchedAt: number } | null = null
let inflight: Promise<WeatherFeed> | null = null

async function doFetch(): Promise<WeatherFeed> {
  // Each half degrades on its own - a broken warnings call shouldn't blank
  // a perfectly good forecast.
  const [fc, wn] = await Promise.allSettled([
    getJson<RawForecast[]>(FORECAST_URL),
    getJson<RawWarning[]>(WARNING_URL),
  ])
  const forecast = fc.status === 'fulfilled' ? parseForecast(fc.value) : cache?.feed.forecast ?? {}
  const warnings = wn.status === 'fulfilled' ? parseWarnings(wn.value) : cache?.feed.warnings ?? []
  const stale = fc.status === 'rejected' || wn.status === 'rejected'
  if (!stale || !cache) cache = { feed: { forecast, warnings }, fetchedAt: Date.now() }
  return { forecast, warnings, stale }
}

export async function fetchWeatherFeed(): Promise<WeatherFeed> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) return { ...cache.feed, stale: false }
  if (inflight) return inflight
  inflight = doFetch().finally(() => { inflight = null })
  return inflight
}
