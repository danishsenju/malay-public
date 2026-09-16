'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo, useRef } from 'react'
import useSWR from 'swr'
import L from 'leaflet'
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import { VehicleLayer } from './map/VehicleLayer'
import { useLang } from '@/lib/i18n'
import { useNow } from '@/hooks/useNow'
import { distanceMeters, normalizeHex, vehicleMatchesRoute } from '@/lib/map'
import type { MapVehicle, ShapeResponse, Station } from '@/lib/map'
import type { Arrival, NearbyStop } from '@/lib/types'

/**
 * Mini live map for one arrival, embedded in the StopSheet: the route line,
 * every checkpoint (stop) along it, the rider's own stop highlighted, and —
 * where a realtime feed exists (bus, KTM) — the actual vehicles gliding on it.
 * Rapid Rail has no vehicle-position feed, so it gets route + stops and an
 * honest note instead of invented dots (DESIGN.md honesty principle).
 */

const json = (url: string) => fetch(url).then(r => r.json())

interface VehicleFeed {
  vehicles: MapVehicle[]
  stale: boolean
}

/** Frame the view once per token — when vehicles land, reframe to include them. */
function FitOnce({ points, token }: { points: [number, number][]; token: string }) {
  const map = useMap()
  const lastFitted = useRef<string | null>(null)
  useEffect(() => {
    if (points.length === 0 || lastFitted.current === token) return
    if (points.length === 1) {
      map.setView(points[0], 15, { animate: false })
    } else {
      map.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 15, animate: false })
    }
    lastFitted.current = token
  }, [points, token, map])
  return null
}

export function ArrivalMiniMap({ stop, arrival }: { stop: NearbyStop; arrival: Arrival }) {
  const { t } = useLang()
  const now = useNow()

  const isBus  = stop.network === 'rapid-bus-kl'
  const isKtmb = stop.network === 'ktmb'
  const isRail = stop.network === 'rapid-rail-kl'
  const routeId = arrival.route_id

  // Checkpoints — every stop on this arrival's route, in riding order.
  const { data: cps } = useSWR<{ stops: Station[] }>(
    routeId ? `/api/routes/${encodeURIComponent(routeId)}/stops?network=${stop.network}` : null,
    json,
    { revalidateOnFocus: false },
  )

  // Route geometry — GTFS shapes exist for bus + rail; KTMB ships none, but
  // its checkpoint dots trace the corridor well enough at this map size.
  const { data: shape } = useSWR<ShapeResponse>(
    !isKtmb && routeId ? `/api/routes/${encodeURIComponent(routeId)}/shape?network=${stop.network}` : null,
    json,
    { revalidateOnFocus: false },
  )

  // Live vehicles — same SWR keys as useRealtimeVehicles / the map page, so
  // this dedupes with the polls the homepage is already running.
  const { data: feed } = useSWR<VehicleFeed>(
    isBus ? '/api/vehicles/bus?category=rapid-bus-kl' : isKtmb ? '/api/vehicles/ktmb' : null,
    json,
    { refreshInterval: 15_000, revalidateOnFocus: true },
  )

  const checkpoints = useMemo(() => cps?.stops ?? [], [cps])

  const vehicles = useMemo<MapVehicle[]>(() => {
    const all = feed?.vehicles ?? []
    if (isBus) {
      return all.filter(v =>
        vehicleMatchesRoute(v.routeId, {
          route_id: routeId ?? '',
          route_short_name: arrival.route_short_name,
        }),
      )
    }
    if (isKtmb) {
      // KTMB realtime carries no reliable per-route ids (the big map shows all
      // trains for the same reason) — keep the trains near this route's
      // corridor so the minimap stays about THIS journey.
      if (checkpoints.length === 0) return all
      return all.filter(v =>
        checkpoints.some(c => distanceMeters(v.lat, v.lon, c.stop_lat, c.stop_lon) <= 2_000),
      )
    }
    return []
  }, [feed, isBus, isKtmb, routeId, arrival.route_short_name, checkpoints])

  // Frame the rider's stop + the live vehicles (the two things being asked
  // about); before vehicles land, frame the whole route instead.
  const fitPoints = useMemo<[number, number][]>(() => {
    const self: [number, number] = [stop.stop_lat, stop.stop_lon]
    if (vehicles.length > 0) return [self, ...vehicles.map(v => [v.lat, v.lon] as [number, number])]
    if (checkpoints.length > 0) return [self, ...checkpoints.map(c => [c.stop_lat, c.stop_lon] as [number, number])]
    return [self]
  }, [stop, vehicles, checkpoints])

  const fitToken = `${routeId}:${vehicles.length > 0 ? 'veh' : checkpoints.length > 0 ? 'route' : 'stop'}`

  const lineColor = normalizeHex(shape?.color ?? arrival.route_color)

  // Freshest GPS age — the same transparency as the big map's status chip.
  const gpsAgeS = useMemo<number | null>(() => {
    const ts = vehicles.map(v => v.timestampMs).filter((n): n is number => n != null)
    if (ts.length === 0) return null
    return Math.max(0, Math.round((now - Math.max(...ts)) / 1000))
  }, [vehicles, now])

  const stale = feed?.stale ?? false
  const liveCount = vehicles.length
  const statusText = isRail
    ? t('mini.railHonesty')
    : liveCount === 0
      ? isKtmb ? t('map.noTrains') : t('map.noBuses')
      : `${liveCount} ${isKtmb ? t('map.train') : t('map.bus')} ${t('map.liveSuffix')}` +
        (stale
          ? ` ${t('map.maybeLate')}`
          : gpsAgeS != null
            ? ` · GPS ${gpsAgeS < 120 ? `${gpsAgeS}s` : `${Math.round(gpsAgeS / 60)} min`} ${t('map.gpsAgo')}`
            : '')

  return (
    <div>
      {/* data-vaul-no-drag: panning the map must not drag the sheet closed */}
      <div
        data-vaul-no-drag
        className="h-[260px] overflow-hidden rounded-2xl border-2 border-ink-black"
      >
        <MapContainer
          center={[stop.stop_lat, stop.stop_lon]}
          zoom={14}
          className="h-full w-full"
          scrollWheelZoom
          zoomControl={false}
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            subdomains="abc"
            maxZoom={19}
          />

          {/* Route line — ink casing under the route colour, as on the big map */}
          {shape?.variants.map((variant, i) => (
            <Polyline
              key={`case-${i}`}
              positions={variant}
              pathOptions={{ color: '#000000', weight: 6, opacity: 1, lineJoin: 'round', lineCap: 'round' }}
            />
          ))}
          {shape?.variants.map((variant, i) => (
            <Polyline
              key={`line-${i}`}
              positions={variant}
              pathOptions={{ color: lineColor, weight: 3.5, opacity: 1, lineJoin: 'round', lineCap: 'round' }}
            />
          ))}

          {/* Checkpoints — every boarding / drop-off point on the route */}
          {checkpoints.map(s => (
            <CircleMarker
              key={`cp-${s.stop_id}`}
              center={[s.stop_lat, s.stop_lon]}
              radius={3.5}
              pathOptions={{ color: '#000000', weight: 2, fillColor: '#ffffff', fillOpacity: 1 }}
            >
              <Tooltip direction="top" offset={[0, -4]} opacity={1}>
                {t('map.stop')} · {s.stop_name}
              </Tooltip>
            </CircleMarker>
          ))}

          {/* The rider's own stop — cobalt, ringed, on top of its checkpoint */}
          <CircleMarker
            center={[stop.stop_lat, stop.stop_lon]}
            radius={7}
            pathOptions={{ color: '#000000', weight: 2, fillColor: '#2665d6', fillOpacity: 1 }}
          >
            <Tooltip direction="top" offset={[0, -6]} opacity={1}>
              {t('mini.yourStop')} · {stop.stop_name}
            </Tooltip>
          </CircleMarker>

          <VehicleLayer vehicles={vehicles} />
          <FitOnce points={fitPoints} token={fitToken} />
        </MapContainer>
      </div>

      {/* Honesty line: live count + GPS age, or why there are no dots */}
      <p className={`mt-8 font-sans text-[11px] leading-relaxed ${isRail ? 'text-sage-mute' : 'font-medium text-ink-black/70'}`}>
        {!isRail && (
          <span
            aria-hidden
            className="mr-6 inline-block h-2 w-2 rounded-full-3 align-middle"
            style={{
              background: liveCount === 0
                ? 'var(--color-sage-mute)'
                : stale ? 'var(--color-mustard-pop)' : 'var(--color-forest-ink)',
            }}
          />
        )}
        {statusText}
      </p>
    </div>
  )
}
