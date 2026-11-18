'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { useLang } from '@/lib/i18n'
import { LEVEL_STYLE, NEARBY_FLOOD_MAX_KM } from '@/lib/flood'
import { formatKm, nearbyRivers } from '@/lib/nearbyFlood'
import type { GeolocationResult } from '@/hooks/useGeolocation'
import { FlapDigit } from './FlapDigit'
import type { StringKey } from '@/lib/strings'
import type { HomeStatus } from '@/app/api/home/status/route'

/**
 * Home's status bento - the at-a-glance state of the network, one tile per
 * question a rider actually has before leaving: is it moving, is it flooding,
 * is the weather turning, is anything broken right now.
 *
 * It replaces the scrolling ticker and the big Network Pulse card. Both were
 * decoration on the most-opened screen; every tile here is live data with its
 * source on it, and each one is a door to the page that explains it.
 *
 * Motion: none on entry (seen dozens of times a day). The vehicle count rides
 * the split-flap digits when the number changes - state indication, the same
 * mechanism as the arrival boards. Press feedback via .pressable-gpu.
 */

interface PulseResponse {
  total: number
  networks: { stale: boolean; count: number }[]
}

const json = (url: string) => fetch(url).then(r => {
  if (!r.ok) throw new Error(`${url} → ${r.status}`)
  return r.json()
})

function hhmm(iso: string | null | undefined): string {
  if (!iso) return '--:--'
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })
}

function Eyebrow({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'inverse' }) {
  return (
    <span
      className={`block font-mono text-[10px] font-bold uppercase tracking-[0.14em] ${
        tone === 'inverse' ? 'text-white-plate/75' : 'text-sage-mute'
      }`}
    >
      {children}
    </span>
  )
}

function Arrow({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden className={`h-14 w-14 shrink-0 ${className}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  )
}

const tile = 'plate pressable-gpu flex min-h-[104px] flex-col justify-between rounded-2xl p-14 text-left'

function LiveTile({ t }: { t: (k: StringKey) => string }) {
  // Same key + fetcher as before, so the ledger keeps being sampled from Home.
  const { data, error } = useSWR<PulseResponse>('/api/pulse', json, { refreshInterval: 15_000, revalidateOnFocus: false })
  const loading = !data && !error
  const anyLive = (data?.networks ?? []).some(n => n.count > 0 && !n.stale)
  const display = loading ? '···' : String(Math.min(data?.total ?? 0, 9999)).padStart(3, ' ')

  return (
    <Link href="/map" className={`${tile} col-span-2`}>
      <span className="flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          {anyLive && (
            <span className="relative flex h-1.75 w-1.75" aria-hidden>
              <span className="absolute inset-0 rounded-full-3 bg-forest-ink" style={{ animation: 'livePulseRing 2s ease-out infinite' }} />
              <span className="relative h-1.75 w-1.75 rounded-full-3 bg-forest-ink" />
            </span>
          )}
          <Eyebrow>Live · data.gov.my</Eyebrow>
        </span>
        <Arrow className="text-ink-black/40" />
      </span>
      <span className="mt-8 flex items-baseline gap-10">
        <span
          className="font-mono text-[40px] font-bold leading-none tracking-[-0.02em] text-ink-black tabular-nums"
          aria-label={loading ? t('common.loading') : `${data?.total ?? 0} ${t('home.status.live')}`}
        >
          {display.split('').map((ch, i) => <FlapDigit key={i} value={ch} delay={i * 40} />)}
        </span>
        <span className="font-sans text-[13px] font-semibold leading-tight text-sage-mute">
          {t('home.status.live')}
        </span>
      </span>
    </Link>
  )
}

/**
 * All tiles are white plates; colour appears only as a small level sticker.
 * Full maroon / deep-blue fills made a screen opened dozens of times a day
 * shout permanently - a single accent says the same thing, and leaves real
 * alarm (a Bahaya sticker) room to stand out.
 */
function LevelPill({ label, bg, text }: { label: string; bg: string; text: string }) {
  return (
    <span
      className="rounded-full-2 border-2 border-ink-black px-8 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.08em]"
      style={{ backgroundColor: bg, color: text }}
    >
      {label}
    </span>
  )
}

function Dot({ color }: { color: string }) {
  return <span aria-hidden className="h-2 w-2 shrink-0 rounded-full-3 border border-ink-black" style={{ backgroundColor: color }} />
}

function TileSkeleton() {
  return <span aria-hidden className="mt-8 h-[30px] w-[70%] rounded-lg bg-ink-black/10" />
}

function FloodTile({ flood, t }: { flood: HomeStatus['flood'] | undefined; t: (k: StringKey) => string }) {
  const worst = !flood ? null : flood.danger ? 'danger' : flood.warning ? 'warning' : flood.alert ? 'alert' : null

  return (
    // Straight to the Banjir tab - the tile is about rivers, so is the landing.
    <Link href="/weather?tab=banjir" className={tile}>
      <span className="flex items-center justify-between gap-8">
        <Eyebrow>{t('home.status.flood')}{flood?.updatedAt ? ` · ${hhmm(flood.updatedAt)}` : ''}</Eyebrow>
        <Arrow className="text-ink-black/40" />
      </span>
      {flood === undefined ? (
        <TileSkeleton />
      ) : flood === null ? (
        <span className="mt-8 font-sans text-[13px] font-bold text-sage-mute">{t('home.status.unavailable')}</span>
      ) : !worst ? (
        <span className="mt-8 flex items-center gap-1.5 font-sans text-[14px] font-extrabold leading-tight tracking-[-0.01em] text-ink-black">
          <Dot color="var(--color-forest-ink)" />
          {t('home.status.floodCalm')}
        </span>
      ) : (
        <span className="mt-8 block">
          <span className="flex items-center gap-8">
            <span className="font-mono text-[26px] font-bold leading-none text-ink-black tabular-nums">{flood[worst]}</span>
            <LevelPill label={t(`wx.level.${worst}` as StringKey)} bg={LEVEL_STYLE[worst].bg} text={LEVEL_STYLE[worst].text} />
          </span>
          <span className="mt-8 flex flex-wrap gap-x-10 gap-y-1 font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-sage-mute tabular-nums">
            {(['danger', 'warning', 'alert'] as const)
              .filter(l => l !== worst && flood[l] > 0)
              .map(l => (
                <span key={l} className="flex items-center gap-1">
                  <Dot color={LEVEL_STYLE[l].bg} />
                  {flood[l]} {t(`wx.level.${l}` as StringKey)}
                </span>
              ))}
          </span>
        </span>
      )}
    </Link>
  )
}

function WeatherTile({ count, t }: { count: number | null | undefined; t: (k: StringKey) => string }) {
  const active = (count ?? 0) > 0
  return (
    // Straight to the Cuaca tab - forecast and MET warnings, not the river map.
    <Link href="/weather?tab=cuaca" className={tile}>
      <span className="flex items-center justify-between gap-8">
        <Eyebrow>{t('home.status.weather')} · MET</Eyebrow>
        <Arrow className="text-ink-black/40" />
      </span>
      {count === undefined ? (
        <TileSkeleton />
      ) : count === null ? (
        <span className="mt-8 font-sans text-[13px] font-bold text-sage-mute">{t('home.status.unavailable')}</span>
      ) : active ? (
        <span className="mt-8 block">
          <span className="flex items-center gap-8">
            <span className="font-mono text-[26px] font-bold leading-none text-ink-black tabular-nums">{count}</span>
            {/* Mustard: the same warning colour as the MET cards on the Cuaca tab. */}
            <LevelPill label="MET" bg="var(--color-mustard-pop)" text="var(--color-ink-black)" />
          </span>
          <span className="mt-8 block font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-sage-mute">
            {t('home.status.weatherSome')}
          </span>
        </span>
      ) : (
        <span className="mt-8 flex items-center gap-1.5 font-sans text-[14px] font-extrabold leading-tight tracking-[-0.01em] text-ink-black">
          <Dot color="var(--color-forest-ink)" />
          {t('home.status.weatherNone')}
        </span>
      )}
    </Link>
  )
}

const SHOWN_NEARBY = 2
const TREND_ARROW = { rising: '↑', falling: '↓', steady: '→' } as const

/**
 * "Flooding near you". Appears ONLY when the rider's real position is known and
 * a river near them is at Waspada or worse - on a calm day Home says nothing
 * extra. With no location (denied, or still resolving) it stays silent rather
 * than guess from the KL Sentral fallback the stop list uses.
 */
function NearbyFloodBanner({
  geo, rivers, updatedAt, t,
}: { geo: GeolocationResult; rivers: HomeStatus['elevated']; updatedAt: string | null; t: (k: StringKey) => string }) {
  if (geo.status !== 'located') return null
  const near = nearbyRivers(geo.lat, geo.lon, rivers)
  if (near.length === 0) return null

  const worst = near[0].level
  const shown = near.slice(0, SHOWN_NEARBY)
  const more = near.length - shown.length

  return (
    <div className="plate col-span-2 rounded-2xl p-14 shadow-plate-sm" role="status">
      <div className="flex items-center justify-between gap-8">
        <LevelPill label={t('home.near.title')} bg={LEVEL_STYLE[worst].bg} text={LEVEL_STYLE[worst].text} />
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-sage-mute tabular-nums">
          JPS {hhmm(updatedAt)}
        </span>
      </div>
      <ul className="mt-8">
        {shown.map((r, i) => (
          <li key={r.id} className={i > 0 ? 'border-t-2 border-dashed border-ink-black/15' : ''}>
            <Link
              href={`/weather?tab=banjir&station=${encodeURIComponent(r.id)}`}
              className="flex items-center gap-10 py-8 active:scale-[0.98]"
              style={{ transition: 'transform 120ms var(--ease-out)' }}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-sans text-[14px] font-extrabold tracking-[-0.01em] text-ink-black">{r.name}</span>
                <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-sage-mute tabular-nums">
                  <Dot color={LEVEL_STYLE[r.level].bg} />
                  {t(`wx.level.${r.level}` as StringKey)} · {formatKm(r.distanceKm)} {t('home.near.away')}
                </span>
              </span>
              <span className="shrink-0 text-right font-mono text-[12px] font-bold text-ink-black tabular-nums">
                {r.waterLevelM != null ? `${r.waterLevelM.toFixed(2)} m` : ''}
                {r.trend && <span className="ml-1 text-sage-mute">{TREND_ARROW[r.trend]}</span>}
              </span>
              <Arrow className="text-ink-black/40" />
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-4 font-mono text-[10px] leading-snug text-sage-mute">
        {more > 0 ? `+${more} ${t('home.near.more')} · ` : ''}
        {t('home.near.note')} ≤ {NEARBY_FLOOD_MAX_KM} km
      </p>
    </div>
  )
}

const SHOWN_DISRUPTIONS = 3

/** Every current disruption, one row each (each row its own shareable record). */
function DisruptionsTile({ list, t }: { list: HomeStatus['disruptions']; t: (k: StringKey) => string }) {
  return (
    <div className="plate col-span-2 rounded-2xl p-14 shadow-plate-sm">
      <div className="flex items-center justify-between gap-8">
        <LevelPill
          label={`${t('home.status.disruption')} · ${list.length}`}
          bg="var(--color-maroon-plate)"
          text="var(--color-white-plate)"
        />
        <Link
          href="/report#gangguan"
          className="flex items-center gap-1 font-mono text-[10px] font-bold uppercase tracking-[0.08em] text-ink-black underline-offset-2 active:scale-[0.96]"
          style={{ transition: 'transform 120ms var(--ease-out)' }}
        >
          {t('home.status.all')} <Arrow />
        </Link>
      </div>
      <ul className="mt-8">
        {list.slice(0, SHOWN_DISRUPTIONS).map((d, i) => (
          <li key={d.id} className={i > 0 ? 'border-t-2 border-dashed border-ink-black/15' : ''}>
            <Link
              href={`/alasan/${d.id}`}
              className="flex items-center gap-10 py-8 active:scale-[0.98]"
              style={{ transition: 'transform 120ms var(--ease-out)' }}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-sans text-[14px] font-extrabold tracking-[-0.01em] text-ink-black">
                  {d.networkLabel}{d.routeId ? ` · ${d.routeId}` : ''}
                </span>
                {/* Time first: on a phone this line truncates, and "when" is
                    the part a rider needs - the type is secondary. */}
                <span className="mt-0.5 block truncate font-mono text-[11px] text-sage-mute tabular-nums">
                  {hhmm(d.startedAt)}–{d.endedAt ? hhmm(d.endedAt) : t('home.status.ongoing')} · {t(`disruption.${d.type}` as StringKey)}
                </span>
              </span>
              <span className="shrink-0 rounded-lg border-2 border-ink-black bg-linen-canvas px-1.5 py-0.5 font-mono text-[11px] font-bold text-ink-black tabular-nums">
                {d.minutes} min
              </span>
              <Arrow className="text-ink-black/40" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function HomeStatusGrid({ geo }: { geo: GeolocationResult }) {
  const { t } = useLang()
  const { data } = useSWR<HomeStatus>('/api/home/status', json, { refreshInterval: 2 * 60_000, revalidateOnFocus: true })

  return (
    <section aria-label={t('home.status.aria')} className="grid grid-cols-2 gap-10">
      {/* The most personal and most urgent thing leads. */}
      {data && <NearbyFloodBanner geo={geo} rivers={data.elevated} updatedAt={data.flood?.updatedAt ?? null} t={t} />}
      <LiveTile t={t} />
      <FloodTile flood={data ? data.flood : undefined} t={t} />
      <WeatherTile count={data ? data.metWarnings : undefined} t={t} />
      {data && data.disruptions.length > 0 && <DisruptionsTile list={data.disruptions} t={t} />}
    </section>
  )
}
