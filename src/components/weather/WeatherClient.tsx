'use client'

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import useSWR from 'swr'
import { PageHeader } from '@/components/PageHeader'
import { SectionLabel } from '@/components/SectionLabel'
import { useLang, type Lang } from '@/lib/i18n'
import { useGeolocation } from '@/hooks/useGeolocation'
import { distanceMeters } from '@/lib/map'
import { DAYS, MONTHS, type StringKey } from '@/lib/strings'
import {
  LEVEL_RANK, LEVEL_STYLE, RAIN_STYLE, STATES, STATE_BY_CODE, isElevated, isStateCode,
  type FloodFeed, type FloodLevel, type FloodStation, type ForecastDay, type MetWarning,
  type RainClass, type StateCode, type WeatherFeed,
} from '@/lib/flood'
import { FloodAlertCard } from './FloodAlertCard'
import { WeatherGlyph, forecastText, whenText } from './forecastText'
import type { MapLayer } from './FloodMap'

const FloodMap = dynamic(() => import('./FloodMap').then(m => m.FloodMap), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-moss-tint" />,
})

const json = (url: string) => fetch(url).then(r => r.json())

// ── Small helpers ────────────────────────────────────────────────────────────

function hhmm(iso: string | null | undefined): string {
  if (!iso) return '--:--'
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })
}

function dayParts(iso: string, lang: Lang): { day: string; date: string } {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d)) // calendar date only - weekday is timezone-safe
  return { day: DAYS[lang][date.getUTCDay()], date: `${d} ${MONTHS[lang][m - 1]}` }
}

function shortDateTime(iso: string, lang: Lang): string {
  const myt = new Date(Date.parse(iso) + 8 * 3600_000)
  return `${DAYS[lang][myt.getUTCDay()]} ${myt.getUTCDate()} ${MONTHS[lang][myt.getUTCMonth()]} ${hhmm(iso)}`
}

const LEVEL_KEY: Record<FloodLevel, StringKey> = {
  danger: 'wx.level.danger',
  warning: 'wx.level.warning',
  alert: 'wx.level.alert',
  normal: 'wx.level.normal',
  unverified: 'wx.level.unverified',
  offline: 'wx.level.offline',
}

const TREND = {
  rising: { arrow: '↑', key: 'wx.trend.rising' },
  falling: { arrow: '↓', key: 'wx.trend.falling' },
  steady: { arrow: '→', key: 'wx.trend.steady' },
} as const satisfies Record<string, { arrow: string; key: StringKey }>

/** How far past its threshold a river is - the tiebreak inside one level. */
function margin(s: FloodStation): number {
  return s.waterLevelM != null && s.thresholdM != null ? s.waterLevelM - s.thresholdM : 0
}

// URL ?state=XXX - set by push notifications so a tap lands on the right state.
const emptySubscribe = () => () => {}
const getUrlState = () => new URLSearchParams(window.location.search).get('state')
const getServerUrlState = () => null

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function LevelSticker({ level, t, className = '' }: { level: FloodLevel; t: (k: StringKey) => string; className?: string }) {
  const c = LEVEL_STYLE[level]
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full-2 border-2 border-ink-black px-8 py-0.75 font-mono text-[10px] font-bold uppercase tracking-[0.08em] ${className}`}
      style={{ backgroundColor: c.bg, color: c.text, borderStyle: level === 'unverified' ? 'dashed' : 'solid' }}
    >
      {t(LEVEL_KEY[level])}
    </span>
  )
}

function LevelTile({ level, count, t }: { level: 'danger' | 'warning' | 'alert'; count: number; t: (k: StringKey) => string }) {
  const lit = count > 0
  const c = LEVEL_STYLE[level]
  return (
    <div
      className="rounded-2xl border-2 border-ink-black px-10 pb-10 pt-8"
      style={{ backgroundColor: lit ? c.bg : 'var(--color-white-plate)', color: lit ? c.text : 'var(--color-sage-mute)' }}
    >
      <span className="block font-mono text-[34px] font-bold leading-none tracking-[-0.02em] tabular-nums">
        {count}
      </span>
      <span className="mt-8 block font-mono text-[10px] font-bold uppercase tracking-[0.12em]">
        {t(LEVEL_KEY[level])}
      </span>
    </div>
  )
}

function StationPanel({ s, t, onClose }: { s: FloodStation; t: (k: StringKey) => string; onClose: () => void }) {
  const trend = s.trend ? TREND[s.trend] : null
  return (
    <div
      className="plate shadow-plate-sm absolute inset-x-10 bottom-10 z-1000 rounded-2xl p-14 lg:left-auto lg:right-14 lg:w-[340px]"
      style={{ animation: 'searchIn 200ms var(--ease-out) both' }}
    >
      <div className="flex items-start gap-10">
        <div className="min-w-0 flex-1">
          {s.level && <LevelSticker level={s.level} t={t} />}
          <p className="mt-8 font-sans text-[15px] font-extrabold leading-snug tracking-[-0.01em] text-ink-black">
            {s.name}
          </p>
          <p className="mt-2 truncate font-mono text-[11px] text-sage-mute">
            {[s.river, s.district, STATE_BY_CODE.get(s.state)?.name].filter(Boolean).join(' · ')}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('search.close')}
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full-3 border-2 border-ink-black bg-white-plate text-ink-black active:scale-[0.94]"
          style={{ transition: 'transform 120ms var(--ease-out)' }}
        >
          <svg aria-hidden className="h-14 w-14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {s.waterLevelM != null && (
        <div className="mt-10 flex items-baseline gap-10 font-mono tabular-nums">
          <span className="text-[24px] font-bold leading-none text-ink-black">{s.waterLevelM.toFixed(2)}<span className="text-body-sm"> m</span></span>
          {s.thresholdM != null && (
            <span className="text-[11px] text-sage-mute">{t('wx.watch.threshold')} {s.thresholdM.toFixed(2)} m</span>
          )}
          {trend && <span className="ml-auto text-[11px] font-bold text-ink-black">{trend.arrow} {t(trend.key)}</span>}
        </div>
      )}
      {s.rain && (
        <p className="mt-8 font-mono text-[11px] text-ink-black tabular-nums">
          {t(`wx.rain.${s.rain}` as StringKey)} · {s.rain1hMm ?? 0} mm {t('wx.rain1h')} · {s.rainTodayMm ?? 0} mm {t('wx.rainToday')}
        </p>
      )}
      <p className="mt-8 font-mono text-[10px] uppercase tracking-[0.08em] text-sage-mute">
        JPS · {hhmm(s.levelAt ?? s.rainAt)} MYT
      </p>
    </div>
  )
}

function WatchRow({ s, index, t, onSelect }: { s: FloodStation; index: number; t: (k: StringKey) => string; onSelect: (s: FloodStation) => void }) {
  const trend = s.trend ? TREND[s.trend] : null
  return (
    // Stagger only the first screenful - a long list cascading for a second
    // reads as slowness, not polish.
    <li style={index < 8 ? { animation: `cardEnter 250ms var(--ease-out) ${index * 45}ms both` } : undefined}>
      <button
        type="button"
        onClick={() => onSelect(s)}
        className="plate pressable-gpu flex w-full items-center gap-14 rounded-2xl p-14 text-left"
      >
        <LevelSticker level={s.level!} t={t} className="w-[72px] shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-sans text-[15px] font-extrabold tracking-[-0.01em] text-ink-black">
            {s.name}
          </span>
          <span className="mt-2 block truncate font-mono text-[11px] text-sage-mute tabular-nums">
            {s.district} · {t('wx.watch.threshold')} {s.thresholdM?.toFixed(2)} m
          </span>
        </span>
        <span className="shrink-0 text-right font-mono tabular-nums">
          <span className="block text-body-sm font-bold text-ink-black">{s.waterLevelM?.toFixed(2)} m</span>
          {trend && (
            <span className="mt-2 block text-[10px] font-bold uppercase tracking-[0.06em] text-sage-mute">
              {trend.arrow} {t(trend.key)}
            </span>
          )}
        </span>
      </button>
    </li>
  )
}

function ForecastCard({ days, state, lang, t }: { days: ForecastDay[] | undefined; state: StateCode; lang: Lang; t: (k: StringKey) => string }) {
  const [today, ...rest] = days ?? []
  return (
    <div className="plate shadow-plate rounded-3xl-2 p-18">
      <div className="flex items-center justify-between gap-10">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-sage-mute">
          {t('wx.forecast.title')} · {STATE_BY_CODE.get(state)?.short}
        </span>
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-sage-mute">MET</span>
      </div>

      {!today ? (
        <p className="mt-14 font-sans text-caption text-sage-mute">{t('wx.forecast.none')}</p>
      ) : (
        <>
          {/* Today - the answer most people opened this card for */}
          <div className="mt-14 flex items-center gap-14">
            <span className="flex h-48 w-48 shrink-0 items-center justify-center rounded-2xl border-2 border-ink-black bg-leaf-wash text-ink-black">
              <WeatherGlyph summary={today.summary} className="h-26 w-26" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-sage-mute">{t('wx.today')}</p>
              <p className="mt-2 font-sans text-[15px] font-extrabold leading-snug tracking-[-0.01em] text-ink-black">
                {forecastText(today.summary, lang)}
                {whenText(today.when, lang) && <span className="font-semibold text-sage-mute"> · {whenText(today.when, lang)}</span>}
              </p>
            </div>
            <span className="shrink-0 font-mono text-[22px] font-bold leading-none text-ink-black tabular-nums">
              {today.minC}–{today.maxC}°
            </span>
          </div>

          {/* Morning / afternoon / night */}
          <div className="mt-14 grid grid-cols-3 gap-8">
            {([['wx.morning', today.morning], ['wx.afternoon', today.afternoon], ['wx.night', today.night]] as const).map(([k, v]) => (
              <div key={k} className="rounded-2xl border-2 border-ink-black/15 bg-white-plate px-10 py-8">
                <span className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-sage-mute">
                  <WeatherGlyph summary={v} className="h-14 w-14 text-ink-black" />
                  {t(k)}
                </span>
                <span className="mt-4 block font-sans text-[11px] font-semibold leading-tight text-ink-black">
                  {forecastText(v, lang)}
                </span>
              </div>
            ))}
          </div>

          {/* Next six days - a list, not a carousel: scannable without swiping */}
          <ul className="mt-14">
            {rest.map(d => (
              <li key={d.date} className="flex items-center gap-10 border-t-2 border-ink-black/10 py-8">
                <span className="w-[64px] shrink-0 font-mono uppercase leading-tight">
                  <span className="block text-[11px] font-bold tracking-[0.04em] text-ink-black">{dayParts(d.date, lang).day}</span>
                  <span className="block text-[10px] tracking-[0.04em] text-sage-mute">{dayParts(d.date, lang).date}</span>
                </span>
                <WeatherGlyph summary={d.summary} className="h-18 w-18 shrink-0 text-ink-black" />
                <span className="min-w-0 flex-1 truncate font-sans text-caption text-midnight-ink">
                  {forecastText(d.summary, lang)}
                </span>
                <span className="shrink-0 font-mono text-caption font-bold text-ink-black tabular-nums">
                  {d.minC}–{d.maxC}°
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function WarningItem({ w, lang, t, index }: { w: MetWarning; lang: Lang; t: (k: StringKey) => string; index: number }) {
  const [open, setOpen] = useState(false)
  const title = (lang === 'en' ? w.titleEn : w.titleMs) || w.titleMs
  const text = (lang === 'en' ? w.textEn : w.textMs) || w.textMs
  return (
    <li style={{ animation: `cardEnter 250ms var(--ease-out) ${index * 50}ms both` }}>
      <div className="plate shadow-plate-sm rounded-2xl p-16">
        <div className="flex items-start gap-10">
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border-2 border-ink-black bg-mustard-pop text-ink-black">
            <svg aria-hidden className="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3.5L2.5 20h19L12 3.5zM12 10v4.5M12 17.5v.01" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-sans text-body-sm font-extrabold leading-snug text-ink-black">{title}</p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.06em] text-sage-mute tabular-nums">
              {t('wx.warnings.issued')} {shortDateTime(w.issued, lang)}
              {w.validTo && <> · {t('wx.warnings.until')} {shortDateTime(w.validTo, lang)}</>}
            </p>
          </div>
        </div>
        {text && (
          <>
            {/* Expand is instant - height animation would be a layout
                animation, and this is reading, not a transition moment. */}
            <p className={`mt-10 whitespace-pre-line font-sans text-caption leading-relaxed text-midnight-ink ${open ? '' : 'line-clamp-3'}`}>
              {text}
            </p>
            <button
              type="button"
              onClick={() => setOpen(o => !o)}
              className="mt-8 font-sans text-caption font-bold text-cobalt-band underline underline-offset-2"
            >
              {open ? t('wx.readLess') : t('wx.readMore')}
            </button>
          </>
        )}
      </div>
    </li>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function WeatherClient() {
  const { t, lang } = useLang()
  const geo = useGeolocation()

  const { data: flood, error: floodError } = useSWR<FloodFeed>('/api/floods', json, {
    refreshInterval: 5 * 60_000,
    revalidateOnFocus: true,
  })
  const { data: weather } = useSWR<WeatherFeed>('/api/weather', json, {
    refreshInterval: 10 * 60_000,
    revalidateOnFocus: false,
  })

  // ── State filter: tap > ?state= from a notification > all of Malaysia ──
  const urlParam = useSyncExternalStore(emptySubscribe, getUrlState, getServerUrlState)
  const [picked, setPicked] = useState<StateCode | 'ALL' | null>(null)
  const activeState: StateCode | null =
    picked === 'ALL' ? null : picked ?? (isStateCode(urlParam) ? urlParam : null)

  const [layer, setLayer] = useState<MapLayer>('flood')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [sizeToken, setSizeToken] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const mapCardRef = useRef<HTMLDivElement>(null)

  const stations = useMemo(() => flood?.stations ?? [], [flood])
  const loading = !flood && !floodError

  // Where the rider is standing → their state (nearest JPS station). Used to
  // default the forecast and the alert picker; never to filter silently.
  const geoState = useMemo<StateCode | null>(() => {
    if (geo.status !== 'located' || stations.length === 0) return null
    let best: FloodStation | null = null
    let bestD = Infinity
    for (const s of stations) {
      const d = distanceMeters(geo.lat, geo.lon, s.lat, s.lon)
      if (d < bestD) { bestD = d; best = s }
    }
    return bestD < 60_000 ? best!.state : null
  }, [geo.status, geo.lat, geo.lon, stations])

  const scoped = useMemo(
    () => (activeState ? stations.filter(s => s.state === activeState) : stations),
    [stations, activeState],
  )

  const counts = useMemo(() => {
    const c = { danger: 0, warning: 0, alert: 0, normal: 0, offline: 0, unverified: 0, raining: 0 }
    for (const s of scoped) {
      if (s.level) c[s.level]++
      if (s.rain) c.raining++
    }
    // Offline stations aren't in the payload - only their per-state counts.
    const off = flood?.offlineByState ?? {}
    c.offline = activeState ? off[activeState] ?? 0 : Object.values(off).reduce((a, b) => a + (b ?? 0), 0)
    return c
  }, [scoped, flood, activeState])

  const watch = useMemo(
    () => scoped
      .filter(s => isElevated(s.level))
      .sort((a, b) => LEVEL_RANK[b.level!] - LEVEL_RANK[a.level!] || margin(b) - margin(a)),
    [scoped],
  )

  // Worst level per state - drives the little badge on each filter chip, so
  // "where is it flooding?" is answered before anyone taps anything.
  const worstByState = useMemo(() => {
    const m = new Map<StateCode, { level: FloodLevel; n: number }>()
    for (const s of stations) {
      if (!isElevated(s.level)) continue
      const cur = m.get(s.state)
      m.set(s.state, {
        level: !cur || LEVEL_RANK[s.level] > LEVEL_RANK[cur.level] ? s.level : cur.level,
        n: (cur?.n ?? 0) + 1,
      })
    }
    return m
  }, [stations])

  const selected = useMemo(() => stations.find(s => s.id === selectedId) ?? null, [stations, selectedId])
  const forecastState: StateCode = activeState ?? geoState ?? 'WLH'

  const warnings = useMemo(() => {
    const list = weather?.warnings ?? []
    if (!activeState) return list
    // Bulletins naming the state you're looking at float to the top.
    const name = STATE_BY_CODE.get(activeState)!.name.toLowerCase()
    return [...list].sort((a, b) => Number(b.textMs.toLowerCase().includes(name)) - Number(a.textMs.toLowerCase().includes(name)))
  }, [weather, activeState])

  function selectFromList(s: FloodStation) {
    setLayer('flood')
    setSelectedId(s.id)
    mapCardRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' })
  }

  function chooseState(code: StateCode | 'ALL') {
    setPicked(code)
    setSelectedId(null)
    setShowAll(false)
  }

  function toggleFullscreen() {
    setFullscreen(f => !f)
    setSizeToken(n => n + 1)
  }

  // Esc leaves fullscreen - keyboard action, so no animation either way.
  useEffect(() => {
    if (!fullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setFullscreen(false); setSizeToken(n => n + 1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen])

  const scopeName = activeState ? STATE_BY_CODE.get(activeState)!.name : null
  const visibleWatch = showAll ? watch : watch.slice(0, 8)
  const calm = !loading && counts.danger + counts.warning + counts.alert === 0

  // ── Sections (ordered for mobile via `order`, grouped into columns on lg) ──

  const hero = (
    <div className="order-1 pt-26" style={{ animation: 'riseIn 340ms var(--ease-out) both' }}>
      <p className="flex items-center gap-8 font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-sage-mute">
        {flood ? (
          <>
            <span
              aria-hidden
              className="h-2 w-2 rounded-full-3 border border-ink-black"
              style={{ backgroundColor: flood.stale ? 'var(--color-mustard-pop)' : 'var(--color-forest-ink)' }}
            />
            {t('wx.updated')} {hhmm(flood.sourceUpdatedAt)} MYT
          </>
        ) : t('wx.loading')}
      </p>
      <h1 className="mt-10 font-sans text-[40px] font-extrabold leading-[1.02] tracking-[-0.03em] text-ink-black lg:text-[44px]">
        {t('wx.title.1')}
        <br />
        <span className="relative inline-block">
          <span
            aria-hidden
            className="-inset-x-1.5 absolute bottom-0.75 h-[0.42em] origin-left rounded-lg"
            style={{
              // The highlighter tells the day's story: lime when calm, mustard
              // when any river in view is past alert level.
              backgroundColor: calm || loading ? 'var(--color-lime-spark)' : 'var(--color-mustard-pop)',
              animation: 'highlightIn 380ms var(--ease-out) 300ms both',
            }}
          />
          <span className="relative">{t('wx.title.2')}</span>
        </span>
      </h1>
      <p className="mt-14 max-w-[44ch] font-sans text-body-sm leading-relaxed text-sage-mute">
        {t('wx.intro')}
      </p>
      {flood?.stale && (
        <p className="mt-14 rounded-2xl border-2 border-ink-black bg-mustard-pop px-14 py-8 font-mono text-[11px] font-bold text-ink-black">
          {t('wx.stale')}
        </p>
      )}
    </div>
  )

  const summary = (
    <div className="order-2" style={{ animation: 'riseIn 340ms var(--ease-out) 60ms both' }}>
      <div className="plate shadow-plate rounded-3xl-2 px-20 py-18">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-sage-mute">
          {scopeName ? `${t('wx.layer.flood')} · ${scopeName}` : t('wx.summary.eyebrow')}
        </span>
        <div className="mt-14 grid grid-cols-3 gap-8" aria-busy={loading}>
          {(['danger', 'warning', 'alert'] as const).map(l => (
            <LevelTile key={l} level={l} count={loading ? 0 : counts[l]} t={t} />
          ))}
        </div>
        <p className="mt-14 font-mono text-[11px] font-medium text-sage-mute tabular-nums">
          {loading ? t('wx.loading') : calm ? t('wx.calm') : (
            <>
              {counts.normal} {t('wx.stationsNormal')} · {counts.offline} {t('wx.stationsOffline')} · {counts.raining} {t('wx.rainNow')}
            </>
          )}
        </p>
        {floodError && !flood && (
          <p className="mt-8 font-sans text-caption font-semibold text-maroon-plate">{t('wx.loadFailed')}</p>
        )}
      </div>
    </div>
  )

  const filterChips = (
    <div
      className="scrollbar-none -mx-20 flex gap-8 overflow-x-auto px-20 pb-[5px] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0"
      role="tablist"
      aria-label={t('wx.filterAria')}
    >
      {([{ code: 'ALL' as const, short: t('wx.filter.all') }, ...STATES]).map(s => {
        const active = (s.code === 'ALL' && !activeState) || s.code === activeState
        const worst = s.code !== 'ALL' ? worstByState.get(s.code) : undefined
        return (
          <button
            key={s.code}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => chooseState(s.code)}
            className={[
              'pressable-gpu flex shrink-0 items-center gap-1.5 rounded-lg border-2 border-ink-black px-10 py-1.5',
              'font-sans text-caption font-bold whitespace-nowrap text-ink-black',
              active ? 'bg-lime-spark' : 'bg-white-plate',
            ].join(' ')}
          >
            {s.short}
            {worst && (
              <span
                className="min-w-[18px] rounded-full-2 border border-ink-black px-1 text-center font-mono text-[10px] leading-[14px] tabular-nums"
                style={{ backgroundColor: LEVEL_STYLE[worst.level].bg, color: LEVEL_STYLE[worst.level].text }}
              >
                {worst.n}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )

  const legend = layer === 'flood' ? (
    <div className="flex flex-wrap items-center gap-x-14 gap-y-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-ink-black">
      {(['alert', 'warning', 'danger'] as const).map(l => (
        <span key={l} className="flex items-center gap-1.5">
          <span className="h-10 w-10 rounded-full-3 border-2 border-ink-black" style={{ backgroundColor: LEVEL_STYLE[l].bg }} />
          {t(LEVEL_KEY[l])}
        </span>
      ))}
      <span className="flex items-center gap-1.5 text-sage-mute">
        <span className="h-10 w-10 rounded-full-3 border-2 border-dashed border-sage-mute bg-moss-tint" />
        {t('wx.level.unverified')}
      </span>
    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-x-14 gap-y-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-ink-black">
      {(['light', 'moderate', 'heavy'] as RainClass[]).map(r => (
        <span key={r} className="flex items-center gap-1.5">
          <span
            className="rounded-full-3 border-2 border-ink-black"
            style={{ backgroundColor: RAIN_STYLE[r].fill, width: r === 'light' ? 8 : r === 'moderate' ? 11 : 14, height: r === 'light' ? 8 : r === 'moderate' ? 11 : 14 }}
          />
          {t(`wx.rain.${r}` as StringKey)}
        </span>
      ))}
      <span className="text-sage-mute tabular-nums">{counts.raining} {t('wx.rainNow')}</span>
    </div>
  )

  const mapSection = (
    <div className="order-3 flex flex-col gap-14">
      {filterChips}
      <div
        ref={mapCardRef}
        className={
          fullscreen
            ? 'fixed inset-0 z-50 isolate bg-linen-canvas'
            : 'plate shadow-plate relative isolate h-[380px] overflow-hidden rounded-3xl-2 lg:h-[540px]'
        }
      >
        <FloodMap
          stations={stations}
          layer={layer}
          focusState={activeState}
          selectedId={selectedId}
          onSelect={s => setSelectedId(s.id)}
          sizeToken={sizeToken}
        />

        {/* Layer switch + fullscreen - one plate, top-left, clear of zoom */}
        <div
          className="absolute left-10 z-1000 flex items-center gap-8"
          style={{ top: fullscreen ? 'max(10px, env(safe-area-inset-top))' : 10 }}
        >
          <div role="tablist" aria-label={t('wx.layerAria')} className="plate shadow-plate-sm flex rounded-full-2 p-[3px]">
            {(['flood', 'rain'] as const).map(l => (
              <button
                key={l}
                type="button"
                role="tab"
                aria-selected={layer === l}
                onClick={() => { setLayer(l); setSelectedId(null) }}
                className="rounded-full-2 px-14 py-1 font-sans text-caption font-bold active:scale-[0.96]"
                style={{
                  backgroundColor: layer === l ? 'var(--color-lime-spark)' : 'transparent',
                  color: layer === l ? 'var(--color-ink-black)' : 'var(--color-sage-mute)',
                  transition: 'background-color 150ms var(--ease-out), color 150ms var(--ease-out), transform 120ms var(--ease-out)',
                }}
              >
                {t(l === 'flood' ? 'wx.layer.flood' : 'wx.layer.rain')}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? t('wx.exitFullscreen') : t('wx.fullscreen')}
            aria-pressed={fullscreen}
            className="plate pressable-sm flex h-[34px] w-[34px] items-center justify-center rounded-full-3 text-ink-black"
          >
            <svg aria-hidden className="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d={fullscreen ? 'M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5' : 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'} />
            </svg>
          </button>
        </div>

        {selected && <StationPanel key="panel" s={selected} t={t} onClose={() => setSelectedId(null)} />}

        {fullscreen && !selected && (
          <div className="plate shadow-plate-sm absolute inset-x-10 bottom-10 z-1000 rounded-2xl px-14 py-10" style={{ marginBottom: 'env(safe-area-inset-bottom)' }}>
            {legend}
          </div>
        )}
      </div>
      {!fullscreen && legend}
    </div>
  )

  const watchSection = (
    <div className="order-4">
      <SectionLabel trailing={loading ? null : `${watch.length}`}>{t('wx.watch.title')}</SectionLabel>
      {loading ? (
        <ul className="mt-14 space-y-10" aria-hidden>
          {[0, 1, 2].map(i => <li key={i} className="h-[66px] rounded-2xl border-2 border-ink-black/10 bg-moss-tint" />)}
        </ul>
      ) : watch.length === 0 ? (
        <p className="plate mt-14 rounded-2xl p-18 text-center font-sans text-body-sm text-sage-mute">
          {t('wx.watch.empty')}
        </p>
      ) : (
        <ul className="mt-14 space-y-10">
          {visibleWatch.map((s, i) => <WatchRow key={s.id} s={s} index={i} t={t} onSelect={selectFromList} />)}
        </ul>
      )}
      {watch.length > 8 && (
        <button
          type="button"
          onClick={() => setShowAll(v => !v)}
          className="pressable-sm mt-14 w-full rounded-full-2 border-2 border-ink-black bg-white-plate py-10 font-sans text-caption font-bold text-ink-black"
        >
          {showAll ? t('wx.showLess') : `${t('wx.showAll')} (${watch.length})`}
        </button>
      )}
      {counts.unverified > 0 && (
        <p className="mt-14 rounded-2xl border-2 border-dashed border-sage-mute bg-moss-tint px-14 py-10 font-sans text-caption leading-snug text-sage-mute">
          <span className="font-mono font-bold text-ink-black tabular-nums">{counts.unverified}</span> {t('wx.unverified')}
        </p>
      )}
    </div>
  )

  const alertsSection = (
    <div className="order-5" style={{ animation: 'riseIn 340ms var(--ease-out) 120ms both' }}>
      <FloodAlertCard suggestedState={activeState ?? geoState} />
    </div>
  )

  const forecastSection = (
    <div className="order-6">
      <ForecastCard days={weather?.forecast[forecastState]} state={forecastState} lang={lang} t={t} />
    </div>
  )

  const warningsSection = (
    <div className="order-7">
      <SectionLabel trailing="MET">{t('wx.warnings.title')}</SectionLabel>
      {weather && warnings.length === 0 ? (
        <p className="plate mt-14 rounded-2xl p-18 text-center font-sans text-body-sm text-sage-mute">
          {t('wx.warnings.none')}
        </p>
      ) : (
        <ul className="mt-14 space-y-10">
          {warnings.map((w, i) => <WarningItem key={`${w.titleEn}-${w.validFrom}-${w.validTo}`} w={w} lang={lang} t={t} index={i} />)}
        </ul>
      )}
    </div>
  )

  return (
    <div className="min-h-screen bg-linen-canvas">
      <PageHeader />
      <div className="mx-auto max-w-md px-20 pb-128 lg:max-w-6xl lg:px-[32px] lg:pb-[80px]">
        {/* Mobile: one column, sections ordered by urgency (rivers first).
            Desktop: the column wrappers become real blocks - left (sticky):
            the "what's my situation" stack; right: the map and evidence. */}
        <div className="flex flex-col gap-26 lg:grid lg:grid-cols-[400px_1fr] lg:items-start lg:gap-x-48 lg:gap-y-0">
          {/* Not sticky (unlike home): this column outgrows the viewport, and a
              sticky block taller than the screen hides its own bottom. */}
          <div className="contents lg:block lg:space-y-26">
            {hero}
            {summary}
            {alertsSection}
            {forecastSection}
          </div>
          <div className="contents lg:block lg:space-y-26 lg:pt-26">
            {mapSection}
            {watchSection}
            {warningsSection}
          </div>
        </div>

        <p className="mt-40 text-center font-mono text-[10px] font-medium uppercase leading-relaxed tracking-[0.08em] text-sage-mute/80">
          {t('wx.footnote')} <Link href="/status" className="underline">/status</Link>
        </p>
      </div>
    </div>
  )
}
