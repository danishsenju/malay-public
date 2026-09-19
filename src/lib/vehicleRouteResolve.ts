import { getSupabaseAdmin } from './supabase';
import type { Vehicle } from './gtfsRealtime';

/**
 * The realtime feed's routeId doesn't always line up with our GTFS-static
 * route identifiers: MRT Feeder's routeId is a short code (e.g. "T802") that
 * matches neither route_id nor route_short_name in our routes table, and
 * several myBAS city feeds (Alor Setar, Kuala Terengganu, Kuching, ...) don't
 * populate routeId at all. trip_id is the one field that DOES tie back to
 * the static schedule 1:1 (verified against trip_route_map for every
 * affected network), so resolve the real route_id through it whenever a
 * match exists - silently keeping whatever routeId the feed already gave us
 * otherwise, so this can never make a working network worse.
 */
export async function resolveVehicleRouteIds(network: string, vehicles: Vehicle[]): Promise<Vehicle[]> {
  const tripIds = [...new Set(vehicles.map(v => v.tripId).filter((t): t is string => !!t))];
  if (tripIds.length === 0) return vehicles;

  const { data, error } = await getSupabaseAdmin()
    .from('trip_route_map')
    .select('trip_id, route_id')
    .eq('network', network)
    .in('trip_id', tripIds);

  if (error || !data || data.length === 0) return vehicles;

  const routeByTrip = new Map<string, string>();
  for (const row of data as { trip_id: string; route_id: string }[]) {
    routeByTrip.set(row.trip_id, row.route_id);
  }
  if (routeByTrip.size === 0) return vehicles;

  return vehicles.map(v => {
    const resolved = v.tripId ? routeByTrip.get(v.tripId) : undefined;
    return resolved ? { ...v, routeId: resolved } : v;
  });
}
