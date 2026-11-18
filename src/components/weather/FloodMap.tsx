'use client'

import 'leaflet/dist/leaflet.css'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Circle, CircleMarker, MapContainer, TileLayer, Tooltip, ZoomControl, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import {
  LEVEL_RANK, LEVEL_STYLE, MALAYSIA_BOUNDS, RAIN_STYLE, isElevated,
  type FloodStation, type StateCode,
} from '@/lib/flood'

export type MapLayer = 'flood' | 'rain'

interface FloodMapProps {
  stations: FloodStation[]
  layer: MapLayer
  /** Frame this state's stations; null = all of Malaysia. */
  focusState: StateCode | null
  selectedId: string | null
  onSelect: (s: FloodStation) => void
  /** Changes whenever the map's box changes size (fullscreen toggle). */
  sizeToken: number
}

/**
 * The "heat" is stepped contour rings, not a blurred gradient: each elevated
 * station paints three concentric, low-opacity discs sized in real metres.
 * Where stations cluster (a flooding basin), the discs stack and the colour
 * deepens - density reads as heat - while every edge stays crisp like the rest
 * of the poster system (CLAUDE.md: no gradients). Discs are non-interactive;
 * only the ink-ringed centre dot takes taps.
 */
const FLOOD_RADIUS_M: Record<'alert' | 'warning' | 'danger', number> = {
  alert: 6_000,
  warning: 9_000,
  danger: 13_000,
}
const RINGS = [
  { scale: 1, opacity: 0.13 },
  { scale: 0.62, opacity: 0.2 },
  { scale: 0.3, opacity: 0.34 },
] as const

/** Normal-level stations are coverage context, not news - only from region zoom in. */
const NORMAL_MIN_ZOOM = 8

function FitToFocus({ stations, focusState }: { stations: FloodStation[]; focusState: StateCode | null }) {
  const map = useMap()
  const last = useRef<string | null>(null)
  useEffect(() => {
    const token = focusState ?? 'ALL'
    if (last.current === token) return
    const pts = focusState ? stations.filter(s => s.state === focusState).map(s => [s.lat, s.lon] as [number, number]) : []
    if (focusState && pts.length === 0) return // wait for data
    map.fitBounds(pts.length > 0 ? L.latLngBounds(pts) : L.latLngBounds(MALAYSIA_BOUNDS), { padding: [24, 24], animate: true })
    last.current = token
  }, [stations, focusState, map])
  return null
}

function FlyToSelected({ station }: { station: FloodStation | null }) {
  const map = useMap()
  const last = useRef<string | null>(null)
  useEffect(() => {
    if (!station || last.current === station.id) return
    last.current = station.id
    // Tapped a dot that's already in view at a usable zoom? Don't yank the
    // map out from under the finger - only fly for list taps / far stations.
    const at = L.latLng(station.lat, station.lon)
    if (map.getZoom() >= 9 && map.getBounds().pad(-0.1).contains(at)) return
    map.flyTo(at, Math.max(map.getZoom(), 10), { duration: 0.6 })
  }, [station, map])
  return null
}

/** Leaflet measures its box once; tell it when the box changes (fullscreen). */
function InvalidateOnResize({ token }: { token: number }) {
  const map = useMap()
  useEffect(() => {
    const id = requestAnimationFrame(() => map.invalidateSize())
    return () => cancelAnimationFrame(id)
  }, [token, map])
  return null
}

function useZoom() {
  const map = useMap()
  const [zoom, setZoom] = useState(() => map.getZoom())
  useMapEvents({ zoomend: () => setZoom(map.getZoom()) })
  return zoom
}

function hhmm(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })
}

function FloodLayer({ stations, selectedId, onSelect }: Pick<FloodMapProps, 'stations' | 'selectedId' | 'onSelect'>) {
  const zoom = useZoom()
  const elevated = useMemo(
    // Worst last, so Bahaya paints on top of Waspada where they overlap.
    () => stations.filter(s => isElevated(s.level)).sort((a, b) => LEVEL_RANK[a.level!] - LEVEL_RANK[b.level!]),
    [stations],
  )
  const normal = useMemo(() => stations.filter(s => s.level === 'normal'), [stations])
  const unverified = useMemo(() => stations.filter(s => s.level === 'unverified'), [stations])

  return (
    <>
      {zoom >= NORMAL_MIN_ZOOM && normal.map(s => (
        <CircleMarker
          key={`n-${s.id}`}
          center={[s.lat, s.lon]}
          radius={3}
          pathOptions={{ color: '#000000', weight: 1.5, fillColor: '#ffffff', fillOpacity: 1 }}
          eventHandlers={{ click: () => onSelect(s) }}
        >
          <Tooltip direction="top" offset={[0, -4]} opacity={1}>{s.name}</Tooltip>
        </CircleMarker>
      ))}

      {/* Bad-threshold stations: hollow, dashed, no heat - visible, not alarming. */}
      {unverified.map(s => (
        <CircleMarker
          key={`u-${s.id}`}
          center={[s.lat, s.lon]}
          radius={4.5}
          pathOptions={{ color: '#676b5f', weight: 1.5, dashArray: '2 2', fillColor: '#e8efd6', fillOpacity: 1 }}
          eventHandlers={{ click: () => onSelect(s) }}
        >
          <Tooltip direction="top" offset={[0, -5]} opacity={1}>{s.name}</Tooltip>
        </CircleMarker>
      ))}

      {elevated.flatMap(s => {
        const lvl = s.level as 'alert' | 'warning' | 'danger'
        const fill = LEVEL_STYLE[lvl].bg
        return RINGS.map((r, i) => (
          <Circle
            key={`h-${s.id}-${i}`}
            center={[s.lat, s.lon]}
            radius={FLOOD_RADIUS_M[lvl] * r.scale}
            interactive={false}
            pathOptions={{ stroke: false, fillColor: fill, fillOpacity: r.opacity }}
          />
        ))
      })}

      {elevated.map(s => {
        const selected = s.id === selectedId
        return (
          <CircleMarker
            key={`e-${s.id}`}
            center={[s.lat, s.lon]}
            radius={selected ? 9 : s.level === 'danger' ? 7 : 6}
            pathOptions={{ color: '#000000', weight: selected ? 3 : 2, fillColor: LEVEL_STYLE[s.level!].bg, fillOpacity: 1 }}
            eventHandlers={{ click: () => onSelect(s) }}
          >
            <Tooltip direction="top" offset={[0, -8]} opacity={1}>
              {s.name} · {s.waterLevelM?.toFixed(2)} m · {hhmm(s.levelAt)}
            </Tooltip>
          </CircleMarker>
        )
      })}
    </>
  )
}

function RainLayer({ stations, selectedId, onSelect }: Pick<FloodMapProps, 'stations' | 'selectedId' | 'onSelect'>) {
  const raining = useMemo(() => {
    const order = { 'light': 0, 'moderate': 1, 'heavy': 2, 'very-heavy': 3 }
    return stations.filter(s => s.rain).sort((a, b) => order[a.rain!] - order[b.rain!])
  }, [stations])

  return (
    <>
      {raining.flatMap(s => {
        const st = RAIN_STYLE[s.rain!]
        return [
          { scale: 1, opacity: 0.14 },
          { scale: 0.5, opacity: 0.26 },
        ].map((r, i) => (
          <Circle
            key={`r-${s.id}-${i}`}
            center={[s.lat, s.lon]}
            radius={st.radiusM * r.scale}
            interactive={false}
            pathOptions={{ stroke: false, fillColor: st.fill, fillOpacity: r.opacity }}
          />
        ))
      })}
      {raining.map(s => (
        <CircleMarker
          key={`rd-${s.id}`}
          center={[s.lat, s.lon]}
          radius={s.id === selectedId ? 8 : 5}
          pathOptions={{ color: '#000000', weight: s.id === selectedId ? 3 : 1.5, fillColor: RAIN_STYLE[s.rain!].fill, fillOpacity: 1 }}
          eventHandlers={{ click: () => onSelect(s) }}
        >
          <Tooltip direction="top" offset={[0, -6]} opacity={1}>
            {s.name} · {s.rain1hMm ?? 0} mm/j
          </Tooltip>
        </CircleMarker>
      ))}
    </>
  )
}

export function FloodMap({ stations, layer, focusState, selectedId, onSelect, sizeToken }: FloodMapProps) {
  const selected = useMemo(() => stations.find(s => s.id === selectedId) ?? null, [stations, selectedId])
  // One canvas for ~1,500 vector shapes; the tolerance widens every dot's
  // tap target to a thumb without drawing it any bigger.
  const renderer = useMemo(() => L.canvas({ tolerance: 8 }), [])

  return (
    <MapContainer
      bounds={MALAYSIA_BOUNDS}
      className="flood-map h-full w-full"
      preferCanvas
      renderer={renderer}
      // Embedded in a scrolling page: the wheel scrolls the page, not the map
      // (zoom with the +/- controls, pinch, or double-tap).
      scrollWheelZoom={false}
      // Peninsula-to-Borneo is ~20° of longitude: on a 390px phone that only
      // fits at zoom ~4.3, so allow quarter steps down to 4.
      zoomSnap={0.25}
      minZoom={4}
      // Top-left belongs to the layer switch (WeatherClient); zoom goes right.
      zoomControl={false}
    >
      <ZoomControl position="topright" />
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · JPS · MET'
        subdomains="abc"
        maxZoom={18}
        className="tiles-muted"
      />
      {layer === 'flood'
        ? <FloodLayer stations={stations} selectedId={selectedId} onSelect={onSelect} />
        : <RainLayer stations={stations} selectedId={selectedId} onSelect={onSelect} />}
      <FitToFocus stations={stations} focusState={focusState} />
      <FlyToSelected station={selected} />
      <InvalidateOnResize token={sizeToken} />
    </MapContainer>
  )
}
