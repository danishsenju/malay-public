// Shared types + helpers for the Live Route Map feature.

/** A vehicle as delivered by /api/vehicles/* JSON (mirrors lib/gtfsRealtime Vehicle). */
export interface MapVehicle {
  id: string
  label?: string
  routeId?: string
  lat: number
  lon: number
  bearing?: number
  timestampMs?: number
}

/** Row from /api/routes. */
export interface RouteSummary {
  route_id: string
  route_short_name: string | null
  route_long_name: string | null
  route_color: string | null // hex without '#'
}

/** Shape from /api/routes/[routeId]/shape. */
export interface ShapeResponse {
  color: string | null // hex without '#'
  variants: [number, number][][] // one polyline per shape variant
}

/** Station from /api/stations. */
export interface Station {
  stop_id: string
  stop_name: string
  stop_lat: number
  stop_lon: number
}

/** Kuala Lumpur - sensible default centre before a route/feed is chosen. */
export const KL_CENTER: [number, number] = [3.139, 101.6869]

/**
 * Distinguishable dot colours for individual vehicles. Every dot carries a 2px
 * ink stroke, so these are picked to stay legible against both the linen canvas
 * and a coloured route line. Deliberately avoids relying on the route colour.
 */
const VEHICLE_PALETTE = [
  '#2665d6', // cobalt band
  '#780016', // maroon plate
  '#d6a337', // mustard pop
  '#254f1a', // forest ink
  '#061492', // cobalt deep
  '#c1440e', // burnt orange
  '#6b21a8', // deep violet
  '#0f766e', // teal
] as const

/** Stable colour per vehicle id - same bus keeps its colour across polls. */
export function vehicleColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return VEHICLE_PALETTE[h % VEHICLE_PALETTE.length]
}

/** '21618C' | '#21618C' | null → '#21618C', falling back to cobalt band. */
export function normalizeHex(hex: string | null | undefined, fallback = '#2665d6'): string {
  if (!hex) return fallback
  const h = hex.startsWith('#') ? hex : `#${hex}`
  return /^#[0-9a-fA-F]{6}$/.test(h) ? h : fallback
}

/** Short display label for a vehicle marker. Buses have no label → use the
 *  plate/id; KTM trains carry a real label like "DMU03". */
export function vehicleLabel(v: MapVehicle): string {
  return v.label && v.label.trim() !== '' ? v.label.trim() : v.id
}

/** Great-circle distance in metres (haversine) - used for "buses near you". */
export function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/**
 * Map-match a vehicle onto the drawn network. KTMB ships no shapes.txt, so
 * the lines are station-to-station chords - a train's true GPS position sits
 * beside the drawn line on every curve, which reads as "the dot is wrong"
 * even though the dot is the truth. Standard map-matching fixes the *display*:
 * project the dot onto the nearest line segment, but only when it's within
 * SNAP_MAX_M - a train genuinely far from the drawn network (depot, siding,
 * unmapped branch) stays at its real GPS position rather than being faked
 * onto a line.
 */
const SNAP_MAX_M = 500

/** Nearest point on any polyline, with its distance in metres. Local
 *  equirectangular projection per query point - the cos(lat) factor is
 *  computed per-point so this works Tumpat to JB. */
export function projectToPolylines(
  lat: number,
  lon: number,
  paths: [number, number][][],
): { lat: number; lon: number; distM: number } {
  const mPerDegLat = 111_320
  const cosLat = Math.cos((lat * Math.PI) / 180)
  let bestD2 = Infinity
  let best: [number, number] = [lat, lon]

  for (const path of paths) {
    for (let i = 0; i < path.length - 1; i++) {
      const [aLat, aLon] = path[i]
      const [bLat, bLon] = path[i + 1]
      const ax = (aLon - lon) * cosLat * mPerDegLat
      const ay = (aLat - lat) * mPerDegLat
      const bx = (bLon - lon) * cosLat * mPerDegLat
      const by = (bLat - lat) * mPerDegLat
      const dx = bx - ax
      const dy = by - ay
      const len2 = dx * dx + dy * dy
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2))
      const px = ax + t * dx
      const py = ay + t * dy
      const d2 = px * px + py * py
      if (d2 < bestD2) {
        bestD2 = d2
        best = [lat + py / mPerDegLat, lon + px / (cosLat * mPerDegLat)]
      }
    }
  }

  return { lat: best[0], lon: best[1], distM: Math.sqrt(bestD2) }
}

export function snapToPolylines(
  lat: number,
  lon: number,
  paths: [number, number][][],
): [number, number] {
  const p = projectToPolylines(lat, lon, paths)
  return p.distM <= SNAP_MAX_M ? [p.lat, p.lon] : [lat, lon]
}

/**
 * Loose route matching between a GTFS-REALTIME vehicle and a GTFS-STATIC
 * route. The two feeds don't always agree on formatting (case, stray spaces,
 * "U6250" vs "6250") - strict equality silently drops real buses, which reads
 * as "the bus is in front of me but not on the map". Match on normalised
 * route_id OR route_short_name, tolerating a single leading letter prefix.
 */
export function vehicleMatchesRoute(
  vehicleRouteId: string | undefined,
  route: { route_id: string; route_short_name: string | null },
): boolean {
  const norm = (s: string | null | undefined) =>
    (s ?? '').trim().toUpperCase().replace(/\s+/g, '')
  const rid = norm(vehicleRouteId)
  if (rid === '') return false
  const candidates = [norm(route.route_id), norm(route.route_short_name)].filter(c => c !== '')
  return candidates.some(c => {
    if (rid === c) return true
    // Tolerate one-letter prefixes either side: T6250 ↔ 6250, U851 ↔ 851.
    const strip = (s: string) => (/^[A-Z]\d+$/.test(s) ? s.slice(1) : s)
    return strip(rid) === strip(c)
  })
}
