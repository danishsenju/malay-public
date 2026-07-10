'use client'

import { useState } from 'react'
import { DirectionalText } from './DirectionalText'
import { useLang } from '@/lib/i18n'
import { useGeolocation } from '@/hooks/useGeolocation'
import { useNearbyStops } from '@/hooks/useNearbyStops'
import { useUpcomingArrivals } from '@/hooks/useUpcomingArrivals'
import { useRealtimeVehicles } from '@/hooks/useRealtimeVehicles'
import { useNow } from '@/hooks/useNow'
import { liveMinutesUntil } from '@/lib/liveTime'
import { ArrivalCard } from './ArrivalCard'
import { SectionLabel } from './SectionLabel'
import type { Arrival, NearbyStop } from '@/lib/types'

// ─── Skeletons ────────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div className="plate min-w-[260px] max-w-[260px] shrink-0 rounded-2xl border-ink-black/15 p-16 flex flex-col gap-14 lg:min-w-0 lg:max-w-none lg:shrink">
      <div className="h-20 w-[80px] rounded-lg bg-concrete-tile/30 animate-pulse" />
      <div className="h-14 w-37.5 rounded-lg bg-concrete-tile/30 animate-pulse" />
      <div className="mx-auto mt-4 h-40 w-25 rounded-lg bg-concrete-tile/30 animate-pulse" />
    </div>
  )
}

function SkeletonGroup() {
  return (
    <div className="space-y-14">
      <div className="h-14 w-[160px] rounded-lg bg-concrete-tile/30 animate-pulse" />
      {/* Mobile: horizontal overflow peek; Desktop: 2-col grid */}
      <div className="flex gap-3 overflow-x-hidden lg:grid lg:grid-cols-2 xl:grid-cols-3">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  )
}

// ─── Per-stop group ──────────────────────────────────────────────────────────

interface StopGroupProps {
  stop:        NearbyStop
  hasLiveBus:  boolean
  hasLiveKtmb: boolean
  busStale:    boolean
  ktmbStale:   boolean
  /** Tapping a specific card passes its arrival so the sheet can open
   *  straight into that arrival's mini live map. */
  onSelect:    (stop: NearbyStop, arrival?: Arrival) => void
}

function StopGroup({ stop, hasLiveBus, hasLiveKtmb, busStale, ktmbStale, onSelect }: StopGroupProps) {
  const { t } = useLang()
  const { arrivals, isLoading } = useUpcomingArrivals(stop.stop_id, stop.network)
  const now = useNow()

  // Recompute minutes against the ticking clock so the flap board counts down
  // in real time between polls — never a "1 min" frozen on screen. Rows whose
  // scheduled time has passed drop out immediately.
  const liveArrivals = arrivals
    .map(a => ({ ...a, minutes_until: liveMinutesUntil(a.arr_secs, now) }))
    .filter(a => a.minutes_until >= 0)

  const isLive = stop.network === 'rapid-bus-kl' ? hasLiveBus
               : stop.network === 'ktmb'          ? hasLiveKtmb
               : false

  const stale  = stop.network === 'rapid-bus-kl' ? busStale
               : stop.network === 'ktmb'          ? ktmbStale
               : false

  const distLabel = stop.distance_m == null
    ? null
    : stop.distance_m < 1000
      ? `${Math.round(stop.distance_m)} m`
      : `${(stop.distance_m / 1000).toFixed(1)} km`

  return (
    <div className="space-y-14">
      <div className="flex items-baseline justify-between gap-14">
        <span className="min-w-0 truncate font-sans text-body font-bold leading-tight tracking-[-0.01em] text-ink-black">
          <DirectionalText text={stop.stop_name} />
        </span>
        {distLabel && (
          <span className="shrink-0 rounded-full-2 border-2 border-ink-black bg-white-plate px-8 py-px font-mono text-[10px] font-bold tabular-nums text-ink-black">
            {distLabel}
          </span>
        )}
      </div>

      {isLoading ? (
        /* Skeleton */
        <div className="flex gap-3 overflow-x-hidden lg:grid lg:grid-cols-2 xl:grid-cols-3">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : liveArrivals.length === 0 ? (
        <p className="py-4 font-sans text-[13px] text-sage-mute">
          {t('home.nearby.noArrivals')}
        </p>
      ) : (
        /* Mobile: horizontal snap-scroll. Desktop (lg): 2-col grid (xl: 3-col). */
        <div className="mx-[-20px] flex gap-3 overflow-x-auto px-20 pb-8 pt-4 snap-x snap-mandatory scrollbar-none lg:mx-0 lg:grid lg:grid-cols-2 lg:overflow-x-visible lg:px-0 xl:grid-cols-3">
          {liveArrivals.slice(0, 3).map((a, i) => (
            <div
              // trip_id:arr_secs alone can collide (feed sometimes emits
              // duplicate rows) — the index disambiguates them.
              key={`${a.trip_id}:${a.arr_secs}:${i}`}
              className="min-w-[260px] max-w-[260px] shrink-0 snap-start lg:min-w-0 lg:max-w-none lg:shrink"
            >
              <ArrivalCard
                routeShortName={a.route_short_name ?? stop.network.toUpperCase()}
                headsign={a.trip_headsign ?? '—'}
                minutesUntil={a.minutes_until}
                network={stop.network}
                isLive={isLive}
                stale={stale}
                routeColor={a.route_color ?? undefined}
                routeTextColor={a.route_text_color ?? undefined}
                index={i}
                onClick={() => onSelect(stop, a)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Network filter chips ────────────────────────────────────────────────────

type NearbyFilter = 'all' | 'rail' | 'bus' | 'ktm'

const FILTER_NETWORK: Record<Exclude<NearbyFilter, 'all'>, NearbyStop['network']> = {
  rail: 'rapid-rail-kl',
  bus:  'rapid-bus-kl',
  ktm:  'ktmb',
}

// ─── Main section ─────────────────────────────────────────────────────────────

interface NearbySectionProps {
  onSelectStop: (stop: NearbyStop, arrival?: Arrival) => void
}

export function NearbySection({ onSelectStop }: NearbySectionProps) {
  const { t } = useLang()
  const geo                                     = useGeolocation()
  const { stops, isLoading, error, radiusUsed } = useNearbyStops(geo.lat, geo.lon)
  const liveStatus                              = useRealtimeVehicles()
  const [filter, setFilter]                     = useState<NearbyFilter>('all')

  const showSkeleton = geo.isPending || isLoading

  const visibleStops = filter === 'all'
    ? stops
    : stops.filter(s => s.network === FILTER_NETWORK[filter])

  const filterChips = (
    <div className="flex gap-8" role="group" aria-label={t('home.nearby')}>
      {(['all', 'rail', 'bus', 'ktm'] as const).map(f => {
        const active = filter === f
        return (
          <button
            key={f}
            type="button"
            aria-pressed={active}
            onClick={() => setFilter(f)}
            className="shrink-0 rounded-full-2 border-2 border-ink-black px-14 py-4 font-mono text-caption font-bold active:scale-[0.95]"
            style={{
              backgroundColor: active ? 'var(--color-lime-spark)' : 'var(--color-white-plate)',
              color: active ? 'var(--color-ink-black)' : 'var(--color-sage-mute)',
              transition: 'background-color 150ms var(--ease-out), color 150ms var(--ease-out), transform 140ms var(--ease-out)',
            }}
          >
            {t(`search.filter.${f}` as const)}
          </button>
        )
      })}
    </div>
  )

  // Detect-location button — lives in the section header so "near WHERE?" is
  // always one tap from being answered with a fresh, exact GPS fix.
  const locateLabel = geo.isPending ? t('home.nearby.locating')
                    : geo.isDefault ? t('home.nearby.detect')
                    : t('home.nearby.nearYou')

  const locateButton = (
    <button
      type="button"
      onClick={geo.refresh}
      disabled={geo.isPending}
      className="
        flex items-center gap-6 rounded-full-2 border-2 border-ink-black bg-white-plate
        px-10 py-2 font-mono text-[10px] font-bold uppercase tracking-widest text-ink-black
        active:scale-[0.96] disabled:opacity-50
      "
      style={{ transition: 'transform 140ms var(--ease-out)' }}
    >
      <svg aria-hidden className="h-3 w-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21c-4.5-4-7-7.2-7-10.2A7 7 0 0 1 12 4a7 7 0 0 1 7 6.8c0 3-2.5 6.2-7 10.2Z" />
        <circle cx="12" cy="10.8" r="2.5" />
      </svg>
      {locateLabel}
    </button>
  )

  return (
    <section className="space-y-18">
      <SectionLabel trailing={locateButton}>{t('home.nearby')}</SectionLabel>

      {/* Location denied — say so honestly instead of quietly showing KL Sentral */}
      {!geo.isPending && geo.status === 'denied' && (
        <p className="font-sans text-caption leading-relaxed text-sage-mute">
          {t('home.nearby.geoDenied')}
        </p>
      )}

      {/* Skeleton while geo + stops resolve */}
      {showSkeleton && (
        <div className="space-y-40">
          <SkeletonGroup />
          <SkeletonGroup />
          <SkeletonGroup />
        </div>
      )}

      {/* Network filter — answers "which of these can I actually ride?" */}
      {!showSkeleton && !error && stops.length > 0 && filterChips}

      {/* Stop groups — one per nearby stop */}
      {!showSkeleton && visibleStops.length > 0 && (
        <div className="space-y-40">
          {visibleStops.map(stop => (
            <StopGroup
              key={`${stop.stop_id}:${stop.network}`}
              stop={stop}
              hasLiveBus={liveStatus.hasLiveBus}
              hasLiveKtmb={liveStatus.hasLiveKtmb}
              busStale={liveStatus.busStale}
              ktmbStale={liveStatus.ktmbStale}
              onSelect={onSelectStop}
            />
          ))}
        </div>
      )}

      {/* Filter matched nothing (but stops exist) — point back to "All" */}
      {!showSkeleton && !error && stops.length > 0 && visibleStops.length === 0 && (
        <p className="py-8 text-center font-sans text-body-sm text-sage-mute">
          {t('home.nearby.filterNone')}
        </p>
      )}

      {/* Error state — the maroon tray makes white type glow; honest copy */}
      {!showSkeleton && error && (
        <div className="rounded-2xl border-2 border-ink-black bg-maroon-plate px-20 py-24 text-center space-y-8">
          <p className="font-sans text-body-sm font-semibold text-white-plate">
            {t('home.nearby.loadFailed')}
          </p>
          <p className="break-all font-mono text-[11px] text-white-plate/60">{error.message}</p>
        </div>
      )}

      {/* Empty state — an invitation on a moss plate, never a dead end */}
      {!showSkeleton && !error && stops.length === 0 && (
        <div className="rounded-2xl border-2 border-ink-black bg-moss-tint px-20 py-40 text-center space-y-8">
          <p className="font-sans text-body-sm font-semibold text-ink-black">
            {t('home.nearby.noneWithin')} {radiusUsed < 1000 ? `${radiusUsed} m` : `${radiusUsed / 1000} km`}
          </p>
          <p className="font-sans text-caption text-sage-mute">
            {geo.isDefault
              ? t('home.nearby.geoDenied')
              : t('home.nearby.getCloser')}
          </p>
        </div>
      )}
    </section>
  )
}
