import { distanceMeters } from './map'
import { LEVEL_RANK, NEARBY_FLOOD_KM, type FloodStation } from './flood'

/**
 * "Flooding near you", computed ON THE DEVICE.
 *
 * The server sends every elevated river (a short, location-free list); the
 * phone measures the distance to its own position. The rider's coordinates are
 * never sent anywhere - the same promise as the on-device Smart Commute.
 * Radii per level live in lib/flood.ts (NEARBY_FLOOD_KM), with the reasoning.
 */

export type NearbyRiverSource = Pick<
  FloodStation,
  'id' | 'name' | 'lat' | 'lon' | 'state' | 'district' | 'waterLevelM' | 'thresholdM' | 'trend' | 'levelAt'
> & { level: 'alert' | 'warning' | 'danger' }

export interface NearbyRiver extends NearbyRiverSource {
  distanceKm: number
}

/**
 * Elevated rivers within their level's radius of (lat, lon): worst level first,
 * then nearest. Empty when nothing qualifies.
 */
export function nearbyRivers(lat: number, lon: number, rivers: NearbyRiverSource[]): NearbyRiver[] {
  const out: NearbyRiver[] = []
  for (const r of rivers) {
    const distanceKm = distanceMeters(lat, lon, r.lat, r.lon) / 1000
    if (distanceKm <= NEARBY_FLOOD_KM[r.level]) out.push({ ...r, distanceKm })
  }
  return out.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || a.distanceKm - b.distanceKm)
}

/** "4.2 km" under 10 km, "12 km" above - decimals past 10 km are false precision. */
export function formatKm(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`
}
