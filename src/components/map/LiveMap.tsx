'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import { VehicleLayer } from './VehicleLayer'
import type { MapVehicle, ShapeResponse, Station } from '@/lib/map'
import { KL_CENTER, normalizeHex } from '@/lib/map'

export interface StaticLine {
  route_id: string
  name: string
  color: string // hex without '#'
  path: [number, number][]
}

interface LiveMapProps {
  vehicles: MapVehicle[]
  shape: ShapeResponse | null // bus route shape; null for KTM / no selection
  stations: Station[]         // KTM stations; empty for bus
  staticLines: StaticLine[]   // KTM line polylines (stop-to-stop); empty for bus
  /** Points to frame the initial view around (bus: route shape; KTM: active
   *  trains, falling back to stations). null while the source data is loading. */
  fitPoints: [number, number][] | null
  /** Changes when the thing we should frame changes (route id or network). */
  fitToken: string
  /** The user's real position (null until geolocation resolves). */
  userPos: [number, number] | null
  /** Tooltip label for the user marker (localised upstream). */
  userLabel: string
  /** Increments each time the user taps "my location" — fly the view there. */
  flyToken: number
}

/** Frames the view around `points` exactly ONCE per `token` — as soon as the
 *  points are available. Firing on token alone would no-op when the data hasn't
 *  loaded yet; firing on every points change would yank the viewport on each
 *  15s poll. Tracking the last-fitted token gives us "fit once, when ready". */
function FitBounds({ points, token }: { points: [number, number][] | null; token: string }) {
  const map = useMap()
  const lastFitted = useRef<string | null>(null)
  useEffect(() => {
    if (!points || points.length === 0) return
    if (lastFitted.current === token) return
    if (points.length === 1) {
      // A lone train would zoom to max — pick a sensible neighbourhood zoom.
      map.setView(points[0], Math.max(map.getZoom(), 13), { animate: true })
    } else {
      map.fitBounds(L.latLngBounds(points), { padding: [48, 48], animate: true })
    }
    lastFitted.current = token
  }, [points, token, map])
  return null
}

/** Flies the view to the user's position, once per locate tap. The position
 *  can arrive AFTER the tap (a fresh GPS fix is async), so this re-fires when
 *  either the token or the position lands — guarded by the last-flown token. */
function FlyToUser({ pos, token }: { pos: [number, number] | null; token: number }) {
  const map = useMap()
  const lastFlown = useRef(0)
  useEffect(() => {
    if (!pos || token === 0 || lastFlown.current === token) return
    map.flyTo(pos, Math.max(map.getZoom(), 15), { duration: 0.8 })
    lastFlown.current = token
  }, [pos, token, map])
  return null
}

export function LiveMap({ vehicles, shape, stations, staticLines, fitPoints, fitToken, userPos, userLabel, flyToken }: LiveMapProps) {
  const lineColor = normalizeHex(shape?.color)

  return (
    <MapContainer
      center={KL_CENTER}
      zoom={12}
      scrollWheelZoom
      className="h-full w-full"
      // Leaflet paints its own controls; keep attribution (OSM/Carto require it).
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
        subdomains="abcd"
        maxZoom={19}
      />

      {/* Route line — ink casing under a coloured stroke for the plate aesthetic. */}
      {shape?.variants.map((variant, i) => (
        <Polyline
          key={`case-${i}`}
          positions={variant}
          pathOptions={{ color: '#000000', weight: 7, opacity: 1, lineJoin: 'round', lineCap: 'round' }}
        />
      ))}
      {shape?.variants.map((variant, i) => (
        <Polyline
          key={`line-${i}`}
          positions={variant}
          pathOptions={{ color: lineColor, weight: 4, opacity: 1, lineJoin: 'round', lineCap: 'round' }}
        />
      ))}

      {/* KTM lines — same ink-casing treatment as bus shapes, one colour per
          route, drawn under the station dots so the network reads as LINES. */}
      {staticLines.map(line => (
        <Polyline
          key={`ktm-case-${line.route_id}`}
          positions={line.path}
          pathOptions={{ color: '#000000', weight: 6, opacity: 1, lineJoin: 'round', lineCap: 'round' }}
        />
      ))}
      {staticLines.map(line => (
        <Polyline
          key={`ktm-line-${line.route_id}`}
          positions={line.path}
          pathOptions={{ color: normalizeHex(line.color), weight: 3.5, opacity: 1, lineJoin: 'round', lineCap: 'round' }}
        >
          <Tooltip sticky opacity={1}>{line.name}</Tooltip>
        </Polyline>
      ))}

      {/* KTM stations — static white plate dots. */}
      {stations.map(s => (
        <CircleMarker
          key={s.stop_id}
          center={[s.stop_lat, s.stop_lon]}
          radius={4}
          pathOptions={{ color: '#000000', weight: 2, fillColor: '#ffffff', fillOpacity: 1 }}
        >
          <Tooltip direction="top" offset={[0, -4]} opacity={1}>
            {s.stop_name}
          </Tooltip>
        </CircleMarker>
      ))}

      {/* You are here — cobalt dot ringed in ink, halo underneath */}
      {userPos && (
        <>
          <CircleMarker
            center={userPos}
            radius={11}
            pathOptions={{ color: '#2665d6', weight: 1, opacity: 0.35, fillColor: '#2665d6', fillOpacity: 0.15 }}
          />
          <CircleMarker
            center={userPos}
            radius={6}
            pathOptions={{ color: '#000000', weight: 2, fillColor: '#2665d6', fillOpacity: 1 }}
          >
            <Tooltip direction="top" offset={[0, -6]} opacity={1}>
              {userLabel}
            </Tooltip>
          </CircleMarker>
        </>
      )}

      <VehicleLayer vehicles={vehicles} />
      <FitBounds points={fitPoints} token={fitToken} />
      <FlyToUser pos={userPos} token={flyToken} />
    </MapContainer>
  )
}
