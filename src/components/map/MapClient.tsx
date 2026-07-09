'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import useSWR from 'swr'
import Link from 'next/link'
import { NetworkRouteSelector, type MapNetwork } from './NetworkRouteSelector'
import { useLang, LangToggle } from '@/lib/i18n'
import { useGeolocation } from '@/hooks/useGeolocation'
import type { StaticLine } from './LiveMap'
import { distanceMeters, projectToPolylines, snapToPolylines, vehicleMatchesRoute } from '@/lib/map'
import type { MapVehicle, RouteSummary, ShapeResponse, Station } from '@/lib/map'

const LiveMap = dynamic(() => import('./LiveMap').then(m => m.LiveMap), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-linen-canvas">
      <span className="font-mono text-caption text-sage-mute">…</span>
    </div>
  ),
})

const json = (url: string) => fetch(url).then(r => r.json())

interface VehicleFeed {
  vehicles: MapVehicle[]
  stale: boolean
  message?: string
}

// "Buses near you" search ring — when no route is picked but the user has
// shared their location, we plot every live bus within this distance so the
// bus physically in front of them is on the map.
const NEARBY_RADIUS_M = 3_000

export function MapClient() {
  const { t } = useLang()
  const [network, setNetwork] = useState<MapNetwork>('ktmb')
  const [selectedRoute, setSelectedRoute] = useState<RouteSummary | null>(null)
  const geo = useGeolocation()
  // Incremented on each "my location" tap — tells the map to fly there.
  const [flyToken, setFlyToken] = useState(0)

  const isBus = network === 'rapid-bus-kl'

  const userPos = useMemo<[number, number] | null>(
    () => (geo.status === 'located' ? [geo.lat, geo.lon] : null),
    [geo.status, geo.lat, geo.lon],
  )

  // ── Data sources (null key disables the request) ──────────────────────────
  const { data: routes, isLoading: routesLoading } = useSWR<RouteSummary[]>(
    isBus ? '/api/routes?network=rapid-bus-kl' : null,
    json,
    { revalidateOnFocus: false },
  )

  const { data: shape } = useSWR<ShapeResponse>(
    isBus && selectedRoute
      ? `/api/routes/${encodeURIComponent(selectedRoute.route_id)}/shape?network=rapid-bus-kl`
      : null,
    json,
    { revalidateOnFocus: false },
  )

  const { data: stations } = useSWR<Station[]>(
    network === 'ktmb' ? '/api/stations?network=ktmb' : null,
    json,
    { revalidateOnFocus: false },
  )

  // KTM route polylines — real OSM track geometry so the network draws as
  // the actual railway, not station-to-station chords.
  const { data: ktmLines } = useSWR<{ lines: StaticLine[] }>(
    network === 'ktmb' ? '/api/ktmb/lines' : null,
    json,
    { revalidateOnFocus: false },
  )

  // A handful of KTMB feed stations carry junk coordinates (232 km off, in
  // the wrong state). A station dot nowhere near any railway is feed noise,
  // not a station — hide it rather than plot fiction. Runs once per load.
  const visibleStations = useMemo<Station[]>(() => {
    const all = stations ?? []
    const paths = (ktmLines?.lines ?? []).map(l => l.path)
    if (paths.length === 0) return all
    return all.filter(s => projectToPolylines(s.stop_lat, s.stop_lon, paths).distM <= 1500)
  }, [stations, ktmLines])

  // Poll whichever realtime feed the network needs. The bus feed is fetched
  // even before a route is chosen — it powers "buses near you".
  const vehiclesKey = network === 'ktmb'
    ? '/api/vehicles/ktmb'
    : '/api/vehicles/bus?category=rapid-bus-kl'

  const { data: feed, isLoading: feedLoading } = useSWR<VehicleFeed>(vehiclesKey, json, {
    refreshInterval: 15_000,
    revalidateOnFocus: true,
  })

  // ── Derived view state ────────────────────────────────────────────────────
  const vehicles = useMemo<MapVehicle[]>(() => {
    const all = feed?.vehicles ?? []
    if (network === 'ktmb') {
      // Map-match trains onto the drawn lines (see snapToPolylines) so dots
      // sit ON the track instead of beside the station-to-station chords.
      const paths = (ktmLines?.lines ?? []).map(l => l.path)
      if (paths.length === 0) return all
      return all.map(v => {
        const [lat, lon] = snapToPolylines(v.lat, v.lon, paths)
        return { ...v, lat, lon }
      })
    }
    // Route chosen → loose matching (realtime route ids don't always equal the
    // static ones byte-for-byte; strict equality dropped real buses).
    if (selectedRoute) return all.filter(v => vehicleMatchesRoute(v.routeId, selectedRoute))
    // No route → every live bus near the user's real position.
    if (!userPos) return []
    return all.filter(v => distanceMeters(v.lat, v.lon, userPos[0], userPos[1]) <= NEARBY_RADIUS_M)
  }, [feed, network, selectedRoute, userPos, ktmLines])

  const fitToken = network === 'ktmb'
    ? 'ktmb'
    : selectedRoute?.route_id ?? (userPos ? 'bus-near-me' : 'bus-none')

  // What the initial view frames. Bus: the route shape. KTM: the active trains'
  // positions, so we open on live movement — falling back to all stations only
  // when zero trains are active. null while the source data is still loading, so
  // FitBounds waits rather than framing a half-loaded (or wrong) target.
  const fitPoints = useMemo<[number, number][] | null>(() => {
    if (isBus) {
      if (selectedRoute) {
        const pts = shape?.variants.flat() ?? []
        return pts.length > 0 ? pts : null
      }
      // Nearby-bus mode — frame the user plus the buses around them.
      return userPos ? [userPos, ...vehicles.map(v => [v.lat, v.lon] as [number, number])] : null
    }
    // KTM — wait for the realtime feed to resolve before deciding.
    if (!feed) return null
    if (vehicles.length > 0) return vehicles.map(v => [v.lat, v.lon])
    return visibleStations.length > 0
      ? visibleStations.map(s => [s.stop_lat, s.stop_lon])
      : null
  }, [isBus, selectedRoute, userPos, shape, feed, vehicles, visibleStations])

  const nearbyMode = isBus && !selectedRoute
  const stale = feed?.stale ?? false

  const statusText = nearbyMode
    ? userPos === null
      ? t('map.locateHint')
      : vehicles.length === 0
        ? t('map.noNearbyBuses')
        : `${vehicles.length} ${t('map.nearbyBuses')}`
    : feedLoading && !feed
      ? t('map.loadingLive')
      : vehicles.length === 0
        ? network === 'ktmb'
          ? t('map.noTrains')
          : t('map.noBuses')
        : `${vehicles.length} ${network === 'ktmb' ? t('map.train') : t('map.bus')} ${t('map.liveSuffix')}`

  // The live dot only makes sense once a feed is actually being plotted.
  const showLiveDot = !nearbyMode || userPos !== null

  function locateMe() {
    geo.refresh()
    setFlyToken(n => n + 1)
  }

  function handleNetworkChange(n: MapNetwork) {
    setNetwork(n)
    setSelectedRoute(null)
  }

  return (
    // `isolate` contains the map's z-1000 controls in their own stacking
    // context so they beat Leaflet's panes without out-painting the app's
    // fixed bottom nav (z-40 in the root context sits above this whole block).
    <div className="relative h-dvh w-full overflow-hidden bg-linen-canvas isolate">
      {/* Map fills the screen */}
      <div className="absolute inset-0">
        <LiveMap
          vehicles={vehicles}
          shape={isBus && selectedRoute ? shape ?? null : null}
          stations={network === 'ktmb' ? visibleStations : []}
          staticLines={network === 'ktmb' ? ktmLines?.lines ?? [] : []}
          fitPoints={fitPoints}
          fitToken={fitToken}
          userPos={userPos}
          userLabel={t('map.locate')}
          flyToken={flyToken}
        />
      </div>

      {/* Floating controls */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-1000 flex flex-col items-center gap-10 p-14">
        <div className="pointer-events-auto flex w-full max-w-md items-center justify-between">
          {/* Same circular back button as every other page */}
          <Link
            href="/"
            aria-label={t('common.backHome')}
            className="plate pressable-sm flex h-40 w-40 items-center justify-center rounded-full-3 text-ink-black"
          >
            <svg aria-hidden className="h-18 w-18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div className="flex items-center gap-8">
            <span className="rounded-lg border-2 border-ink-black bg-lime-spark px-10 py-6 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-ink-black">
              {t('map.title')}
            </span>
            <LangToggle />
          </div>
        </div>

        <div className="pointer-events-auto w-full max-w-md">
          <NetworkRouteSelector
            network={network}
            onNetworkChange={handleNetworkChange}
            routes={routes}
            routesLoading={routesLoading}
            selectedRoute={selectedRoute}
            onSelectRoute={setSelectedRoute}
          />
        </div>
      </div>

      {/* Status chip — lifted clear of the persistent bottom nav on mobile;
          on desktop (lg:) there's no bottom nav, so it sits at the edge. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-1000 flex items-center justify-center gap-10 px-14 pb-18.5 pt-14 lg:pb-14">
        <div className="plate shadow-plate-sm flex items-center gap-8 rounded-full-2 px-14 py-8">
          {showLiveDot && (
            <span className="relative flex h-2 w-2">
              {!stale && (
                <span
                  className="absolute inset-0 rounded-full-3 bg-forest-ink"
                  style={{ animation: 'livePulseRing 2s ease-out infinite' }}
                />
              )}
              <span
                className="relative h-2 w-2 rounded-full-3"
                style={{ background: stale ? 'var(--color-mustard-pop)' : 'var(--color-forest-ink)' }}
              />
            </span>
          )}
          <span className="font-mono text-caption font-bold tabular-nums text-ink-black">
            {statusText}
          </span>
          {stale ? (
            <span className="font-sans text-[10px] text-sage-mute">{t('map.maybeLate')}</span>
          ) : (
            // Set the waiting expectation up front: dots refresh on a 15s poll.
            <span className="whitespace-nowrap font-sans text-[10px] text-sage-mute">{t('map.refresh')}</span>
          )}
        </div>

        {/* My location — fresh GPS fix + fly the map there */}
        <button
          type="button"
          aria-label={geo.isPending ? t('map.locating') : t('map.locate')}
          onClick={locateMe}
          disabled={geo.isPending}
          className="plate pressable-sm pointer-events-auto flex h-40 w-40 shrink-0 items-center justify-center rounded-full-3 text-ink-black disabled:opacity-50"
        >
          <svg aria-hidden className="h-18 w-18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <circle cx="12" cy="12" r="3" />
            <path strokeLinecap="round" d="M12 2v3m0 14v3M2 12h3m14 0h3" />
            <circle cx="12" cy="12" r="7.5" />
          </svg>
        </button>
      </div>
    </div>
  )
}
