'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import { VehicleLayer } from './VehicleLayer'
import type { MapVehicle, ShapeResponse, Station } from '@/lib/map'
import { KL_CENTER, normalizeHex } from '@/lib/map'

interface LiveMapProps {
  vehicles: MapVehicle[]
  shape: ShapeResponse | null // bus route shape; null for KTM / no selection
  stations: Station[]         // KTM stations; empty for bus
  /** Points to frame the initial view around (bus: route shape; KTM: active
   *  trains, falling back to stations). null while the source data is loading. */
  fitPoints: [number, number][] | null
  /** Changes when the thing we should frame changes (route id or network). */
  fitToken: string
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

export function LiveMap({ vehicles, shape, stations, fitPoints, fitToken }: LiveMapProps) {
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

      <VehicleLayer vehicles={vehicles} />
      <FitBounds points={fitPoints} token={fitToken} />
    </MapContainer>
  )
}
