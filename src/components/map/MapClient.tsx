'use client'

import { useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import useSWR from 'swr'
import Link from 'next/link'
import { NetworkRouteSelector, type MapNetwork } from './NetworkRouteSelector'
import { useLang, LangToggle } from '@/lib/i18n'
import type { StaticLine } from './LiveMap'
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

export function MapClient() {
  const { t } = useLang()
  const [network, setNetwork] = useState<MapNetwork>('ktmb')
  const [selectedRoute, setSelectedRoute] = useState<RouteSummary | null>(null)

  const isBus = network === 'rapid-bus-kl'

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

  // KTM route polylines — static geometry so the network draws as lines.
  const { data: ktmLines } = useSWR<{ lines: StaticLine[] }>(
    network === 'ktmb' ? '/api/ktmb/lines' : null,
    json,
    { revalidateOnFocus: false },
  )

  // Only poll the realtime feed we can actually plot: KTM always; bus only once
  // a route is chosen (we filter to that route's vehicles).
  const vehiclesKey = network === 'ktmb'
    ? '/api/vehicles/ktmb'
    : selectedRoute
      ? '/api/vehicles/bus?category=rapid-bus-kl'
      : null

  const { data: feed, isLoading: feedLoading } = useSWR<VehicleFeed>(vehiclesKey, json, {
    refreshInterval: 15_000,
    revalidateOnFocus: false,
  })

  // ── Derived view state ────────────────────────────────────────────────────
  const vehicles = useMemo<MapVehicle[]>(() => {
    const all = feed?.vehicles ?? []
    if (network === 'ktmb') return all
    if (!selectedRoute) return []
    return all.filter(v => v.routeId === selectedRoute.route_id)
  }, [feed, network, selectedRoute])

  const fitToken = network === 'ktmb' ? 'ktmb' : selectedRoute?.route_id ?? 'bus-none'

  // What the initial view frames. Bus: the route shape. KTM: the active trains'
  // positions, so we open on live movement — falling back to all stations only
  // when zero trains are active. null while the source data is still loading, so
  // FitBounds waits rather than framing a half-loaded (or wrong) target.
  const fitPoints = useMemo<[number, number][] | null>(() => {
    if (isBus) {
      const pts = shape?.variants.flat() ?? []
      return pts.length > 0 ? pts : null
    }
    // KTM — wait for the realtime feed to resolve before deciding.
    if (!feed) return null
    if (vehicles.length > 0) return vehicles.map(v => [v.lat, v.lon])
    return stations && stations.length > 0
      ? stations.map(s => [s.stop_lat, s.stop_lon])
      : null
  }, [isBus, shape, feed, vehicles, stations])

  const needsRoute = isBus && !selectedRoute
  const stale = feed?.stale ?? false

  const statusText = needsRoute
    ? t('map.pickBusRoute')
    : feedLoading && !feed
      ? t('map.loadingLive')
      : vehicles.length === 0
        ? network === 'ktmb'
          ? t('map.noTrains')
          : t('map.noBuses')
        : `${vehicles.length} ${network === 'ktmb' ? t('map.train') : t('map.bus')} ${t('map.liveSuffix')}`

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
          shape={isBus ? shape ?? null : null}
          stations={network === 'ktmb' ? stations ?? [] : []}
          staticLines={network === 'ktmb' ? ktmLines?.lines ?? [] : []}
          fitPoints={fitPoints}
          fitToken={fitToken}
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
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-1000 flex justify-center px-14 pb-18.5 pt-14 lg:pb-14">
        <div className="plate shadow-plate-sm flex items-center gap-8 rounded-full-2 px-14 py-8">
          {!needsRoute && (
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
          {stale && (
            <span className="font-sans text-[10px] text-sage-mute">{t('map.maybeLate')}</span>
          )}
        </div>
      </div>
    </div>
  )
}
