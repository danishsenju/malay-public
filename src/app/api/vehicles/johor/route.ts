import { NextResponse } from 'next/server';
import { fetchFeed } from '@/lib/gtfsRealtime';
import { getOpenFeedGap } from '@/lib/ledger';
import { resolveVehicleRouteIds } from '@/lib/vehicleRouteResolve';

const MYBAS_URL =
  'https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-johor';

export async function GET() {
  const feed = await fetchFeed(MYBAS_URL);
  const vehicles = await resolveVehicleRouteIds('mybas-johor', feed.vehicles);
  // Zero buses is ambiguous by itself - "genuinely no service right now"
  // and "data.gov.my's feed is down" look identical otherwise.
  const feedGap = vehicles.length === 0 ? await getOpenFeedGap('mybas-johor') : null;
  return NextResponse.json(
    { vehicles, stale: feed.stale, ...(feed.message ? { message: feed.message } : {}), ...(feedGap ? { feedGap } : {}) },
    { status: feed.fetchedAt === 0 ? 503 : 200 },
  );
}
