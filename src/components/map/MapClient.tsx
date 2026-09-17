'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import useSWR from 'swr'
import Link from 'next/link'
import { NetworkRouteSelector, type MapNetwork } from './NetworkRouteSelector'
import { HeaderNav } from '@/components/AppNav'
import { useLang, LangToggle } from '@/lib/i18n'
import { useGeolocation } from '@/hooks/useGeolocation'
import { useNow } from '@/hooks/useNow'
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
  // Set only when vehicles is empty AND the delay ledger has an open
  // feed_outage/service_gap for this network - lets the UI say "the feed's
  // broken" instead of implying service has actually stopped.
  feedGap?: { eventType: 'feed_outage' | 'service_gap'; since: string }
}

// "Buses near you" search ring - when no route is picked but the user has
// shared their location, we plot every live bus within this distance so the
// bus physically in front of them is on the map.
const NEARBY_RADIUS_M = 3_000

export function MapClient() {
  const { t } = useLang()
  const [network, setNetwork] = useState<MapNetwork>('ktmb')
  const [selectedRoute, setSelectedRoute] = useState<RouteSummary | null>(null)
  const geo = useGeolocation()
  // Incremented on each "my location" tap - tells the map to fly there.
  const [flyToken, setFlyToken] = useState(0)

  // Both networks ship real GTFS static routes/shapes/stops - Rapid KL Bus
  // via Prasarana, myBAS Johor via Causeway Link (data.gov.my just never
  // documented the latter). KTM is the only network with no route picker.
  const hasRoutes = network === 'rapid-bus-kl' || network === 'mybas-johor'

  const userPos = useMemo<[number, number] | null>(
    () => (geo.status === 'located' ? [geo.lat, geo.lon] : null),
    [geo.status, geo.lat, geo.lon],
  )

  // Frame the rider's real position the moment it resolves, so opening the
  // map answers "where am I?" immediately instead of leaving them to spot a
  // tiny dot inside a nationwide KTM overview. Routed through fitPoints/
  // fitToken (below) rather than a separate flyTo - a competing effect would
  // race the network-overview fit that fires once the KTM feed loads, and
  // whichever settled last would silently win. Plain derived value (not
  // state) so there's no setState-in-effect cascade: 'pending' holds off any
  // fit at all until we know whether a fix is coming; 'user' locks onto it
  // once it lands; 'network' (denied/unavailable, or the rider taps a tab /
  // "my location" themselves - interactedRef latches permanently) hands
  // framing back to the normal per-network logic and never reverts.
  const [interacted, setInteracted] = useState(false)
  const initialFocusMode: 'pending' | 'user' | 'network' = interacted
    ? 'network'
    : geo.status === 'located'
      ? 'user'
      : geo.status === 'denied' || geo.status === 'unavailable'
        ? 'network'
        : 'pending'

  // ── Data sources (null key disables the request) ──────────────────────────
  const { data: routes, isLoading: routesLoading } = useSWR<RouteSummary[]>(
    hasRoutes ? `/api/routes?network=${network}` : null,
    json,
    { revalidateOnFocus: false },
  )

  const { data: shape } = useSWR<ShapeResponse>(
    hasRoutes && selectedRoute
      ? `/api/routes/${encodeURIComponent(selectedRoute.route_id)}/shape?network=${network}`
      : null,
    json,
    { revalidateOnFocus: false },
  )

  // Drop-off checkpoints - every stop along the selected bus route, drawn as
  // dots on the line so riders can see exactly where they can board/alight.
  const { data: routeStops } = useSWR<{ stops: Station[] }>(
    hasRoutes && selectedRoute
      ? `/api/routes/${encodeURIComponent(selectedRoute.route_id)}/stops?network=${network}`
      : null,
    json,
    { revalidateOnFocus: false },
  )

  const { data: stations } = useSWR<Station[]>(
    network === 'ktmb' ? '/api/stations?network=ktmb' : null,
    json,
    { revalidateOnFocus: false },
  )

  // KTM route polylines - real OSM track geometry so the network draws as
  // the actual railway, not station-to-station chords.
  const { data: ktmLines } = useSWR<{ lines: StaticLine[] }>(
    network === 'ktmb' ? '/api/ktmb/lines' : null,
    json,
    { revalidateOnFocus: false },
  )

  // A handful of KTMB feed stations carry junk coordinates (232 km off, in
  // the wrong state). A station dot nowhere near any railway is feed noise,
  // not a station - hide it rather than plot fiction. Runs once per load.
  const visibleStations = useMemo<Station[]>(() => {
    const all = stations ?? []
    const paths = (ktmLines?.lines ?? []).map(l => l.path)
    if (paths.length === 0) return all
    return all.filter(s => projectToPolylines(s.stop_lat, s.stop_lon, paths).distM <= 1500)
  }, [stations, ktmLines])

  // Poll whichever realtime feed the network needs. The bus feed is fetched
  // even before a route is chosen - it powers "buses near you".
  const vehiclesKey = network === 'ktmb'
    ? '/api/vehicles/ktmb'
    : network === 'mybas-johor'
      ? '/api/vehicles/johor'
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
    // static ones byte-for-byte; strict equality dropped real buses). Johor's
    // realtime feed happens to match its static route_id exactly, but the
    // same loose matcher is harmless there too.
    if (selectedRoute) return all.filter(v => vehicleMatchesRoute(v.routeId, selectedRoute))
    // No route → every live bus near the user's real position.
    if (!userPos) return []
    return all.filter(v => distanceMeters(v.lat, v.lon, userPos[0], userPos[1]) <= NEARBY_RADIUS_M)
  }, [feed, network, selectedRoute, userPos, ktmLines])

  // Namespaced by network so switching tabs always re-frames the view, even
  // when two networks land on the same sub-state (e.g. both "no route, no
  // user position" for rapid-bus-kl and mybas-johor).
  const fitToken = initialFocusMode === 'user'
    ? 'auto-user-locate'
    : network === 'ktmb'
      ? 'ktmb'
      : `${network}:${selectedRoute?.route_id ?? (userPos ? 'near-me' : 'none')}`

  // What the initial view frames. Bus: the route shape. KTM: the active trains'
  // positions, so we open on live movement - falling back to all stations only
  // when zero trains are active. null while the source data is still loading, so
  // FitBounds waits rather than framing a half-loaded (or wrong) target.
  const fitPoints = useMemo<[number, number][] | null>(() => {
    if (initialFocusMode === 'pending') return null
    if (initialFocusMode === 'user') return userPos ? [userPos] : null
    if (hasRoutes) {
      if (selectedRoute) {
        const pts = shape?.variants.flat() ?? []
        return pts.length > 0 ? pts : null
      }
      // Nearby-bus mode - frame the user plus the buses around them.
      return userPos ? [userPos, ...vehicles.map(v => [v.lat, v.lon] as [number, number])] : null
    }
    // KTM - wait for the realtime feed to resolve before deciding.
    if (!feed) return null
    if (vehicles.length > 0) return vehicles.map(v => [v.lat, v.lon])
    return visibleStations.length > 0
      ? visibleStations.map(s => [s.stop_lat, s.stop_lon])
      : null
  }, [initialFocusMode, hasRoutes, selectedRoute, userPos, shape, feed, vehicles, visibleStations])

  const nearbyMode = hasRoutes && !selectedRoute
  const stale = feed?.stale ?? false
  const feedGap = feed?.feedGap ?? null

  // Freshest GPS report age among the plotted vehicles - surfacing it in the
  // status chip tells riders exactly how far behind reality the dots run
  // (upstream feed lag + our 15s cache), instead of leaving them to guess.
  // useNow is the app's shared 10s clock, so the age keeps ticking between polls.
  const now = useNow()
  const gpsAgeS = useMemo<number | null>(() => {
    const ts = vehicles.map(v => v.timestampMs).filter((n): n is number => n != null)
    if (ts.length === 0) return null
    return Math.max(0, Math.round((now - Math.max(...ts)) / 1000))
  }, [vehicles, now])

  // A known upstream gap outranks every other empty-list message - "no buses
  // within 3km" or "no active buses" both read as "service has stopped",
  // when what's actually true is data.gov.my's feed going quiet. Riders
  // should never have to guess which one they're looking at.
  const statusText = feedGap && vehicles.length === 0
    ? t('map.feedGap')
    : nearbyMode
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
    setInteracted(true)
    geo.refresh()
    setFlyToken(n => n + 1)
  }

  function handleNetworkChange(n: MapNetwork) {
    setInteracted(true)
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
          shape={hasRoutes && selectedRoute ? shape ?? null : null}
          routeStops={hasRoutes && selectedRoute ? routeStops?.stops ?? [] : []}
          stopLabel={t('map.stop')}
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
        {/* Same single-pill masthead as every other page (PageHeader), just
            floating over the map instead of sitting in document flow -
            keeps back-button + page-title grouped left, nav in the middle,
            controls on the right, all sharing one plate so the whole thing
            reads as one bar rather than scattered elements over map tiles. */}
        <div className="pointer-events-auto plate shadow-plate-sm flex w-full max-w-md items-center justify-between rounded-full-2 py-2.25 pl-2.5 pr-18 lg:max-w-6xl">
          <span className="flex items-center gap-8">
            <Link
              href="/"
              aria-label={t('common.backHome')}
              className="pressable-sm flex h-40 w-40 shrink-0 items-center justify-center rounded-full-3 text-ink-black"
            >
              <svg aria-hidden className="h-18 w-18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <span className="rounded-lg border-2 border-ink-black bg-lime-spark px-10 py-1 font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-ink-black">
              {t('map.title')}
            </span>
          </span>
          <HeaderNav />
          <LangToggle />
        </div>

        <div className="pointer-events-auto w-full max-w-md lg:max-w-2xl">
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

      {/* Status chip - lifted clear of the persistent bottom nav on mobile;
          on desktop (lg:) there's no bottom nav, so it sits at the edge. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-1000 flex items-center justify-center gap-10 px-14 pb-18.5 pt-14 lg:pb-14">
        <div className="plate shadow-plate-sm flex items-center gap-8 rounded-full-2 px-14 py-8">
          {showLiveDot && (
            <span className="relative flex h-2 w-2">
              {!stale && !(feedGap && vehicles.length === 0) && (
                <span
                  className="absolute inset-0 rounded-full-3 bg-forest-ink"
                  style={{ animation: 'livePulseRing 2s ease-out infinite' }}
                />
              )}
              <span
                className="relative h-2 w-2 rounded-full-3"
                style={{ background: stale || (feedGap && vehicles.length === 0) ? 'var(--color-mustard-pop)' : 'var(--color-forest-ink)' }}
              />
            </span>
          )}
          <span className="font-mono text-caption font-bold tabular-nums text-ink-black">
            {statusText}
          </span>
          {stale ? (
            <span className="font-sans text-[10px] text-sage-mute">{t('map.maybeLate')}</span>
          ) : gpsAgeS != null ? (
            // Radical transparency: say exactly how old the freshest GPS
            // report is, so "why is the dot behind the bus?" answers itself.
            <span className="whitespace-nowrap font-sans text-[10px] text-sage-mute">
              · GPS {gpsAgeS < 120 ? `${gpsAgeS}s` : `${Math.round(gpsAgeS / 60)} min`} {t('map.gpsAgo')}
            </span>
          ) : (
            // Set the waiting expectation up front: dots refresh on a 15s poll.
            <span className="whitespace-nowrap font-sans text-[10px] text-sage-mute">{t('map.refresh')}</span>
          )}
        </div>

        {/* My location - fresh GPS fix + fly the map there */}
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
