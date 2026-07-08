'use client'

// Styles "KE ARAH" in stop names as a dim separator so the destination
// station reads clearly — e.g. "KL SENTRAL KE ARAH SEREMBAN" becomes:
//   KL SENTRAL  <→>  SEREMBAN
function StopName({ name }: { name: string }) {
  const match = name.match(/^(.+?)\s*(?:ke\s+arah|→|->)\s*(.+)$/i)
  if (!match) return <>{name}</>
  return (
    <>
      {match[1]}
      <span className="mx-1.5 font-normal text-sage-mute/60">→</span>
      {match[2]}
    </>
  )
}
import { useGeolocation } from '@/hooks/useGeolocation'
import { useNearbyStops } from '@/hooks/useNearbyStops'
import { useUpcomingArrivals } from '@/hooks/useUpcomingArrivals'
import { useRealtimeVehicles } from '@/hooks/useRealtimeVehicles'
import { ArrivalCard } from './ArrivalCard'
import { SectionLabel } from './SectionLabel'
import type { NearbyStop } from '@/lib/types'

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
  onSelect:    (stop: NearbyStop) => void
}

function StopGroup({ stop, hasLiveBus, hasLiveKtmb, busStale, ktmbStale, onSelect }: StopGroupProps) {
  const { arrivals, isLoading } = useUpcomingArrivals(stop.stop_id, stop.network)

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
          <StopName name={stop.stop_name} />
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
      ) : arrivals.length === 0 ? (
        <p className="py-4 font-sans text-[13px] text-sage-mute">
          Tiada ketibaan dalam 90 minit akan datang
        </p>
      ) : (
        /* Mobile: horizontal snap-scroll. Desktop (lg): 2-col grid (xl: 3-col). */
        <div className="mx-[-20px] flex gap-3 overflow-x-auto px-20 pb-8 pt-4 snap-x snap-mandatory scrollbar-none lg:mx-0 lg:grid lg:grid-cols-2 lg:overflow-x-visible lg:px-0 xl:grid-cols-3">
          {arrivals.slice(0, 3).map((a, i) => (
            <div
              key={`${a.trip_id}:${a.arr_secs}`}
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
                onClick={() => onSelect(stop)}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main section ─────────────────────────────────────────────────────────────

interface NearbySectionProps {
  onSelectStop: (stop: NearbyStop) => void
}

export function NearbySection({ onSelectStop }: NearbySectionProps) {
  const geo                                     = useGeolocation()
  const { stops, isLoading, error, radiusUsed } = useNearbyStops(geo.lat, geo.lon)
  const liveStatus                              = useRealtimeVehicles()

  const showSkeleton  = geo.isPending || isLoading
  const locationLabel = geo.isDefault ? 'KL Sentral' : 'Dekat anda'

  return (
    <section className="space-y-18">
      <SectionLabel trailing={locationLabel}>Berdekatan</SectionLabel>

      {/* Skeleton while geo + stops resolve */}
      {showSkeleton && (
        <div className="space-y-40">
          <SkeletonGroup />
          <SkeletonGroup />
          <SkeletonGroup />
        </div>
      )}

      {/* Stop groups — one per nearby stop */}
      {!showSkeleton && stops.length > 0 && (
        <div className="space-y-40">
          {stops.map(stop => (
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

      {/* Error state — the maroon tray makes white type glow; honest copy */}
      {!showSkeleton && error && (
        <div className="rounded-2xl border-2 border-ink-black bg-maroon-plate px-20 py-24 text-center space-y-8">
          <p className="font-sans text-body-sm font-semibold text-white-plate">
            Tak dapat muatkan hentian berdekatan
          </p>
          <p className="break-all font-mono text-[11px] text-white-plate/60">{error.message}</p>
        </div>
      )}

      {/* Empty state — an invitation on a moss plate, never a dead end */}
      {!showSkeleton && !error && stops.length === 0 && (
        <div className="rounded-2xl border-2 border-ink-black bg-moss-tint px-20 py-40 text-center space-y-8">
          <p className="font-sans text-body-sm font-semibold text-ink-black">
            Tiada hentian dalam {radiusUsed < 1000 ? `${radiusUsed} m` : `${radiusUsed / 1000} km`}
          </p>
          <p className="font-sans text-caption text-sage-mute">
            {geo.isDefault
              ? 'Akses lokasi ditolak — menunjukkan sekitar KL Sentral'
              : 'Cuba dekati mana-mana hentian transit'}
          </p>
        </div>
      )}
    </section>
  )
}
