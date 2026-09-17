import { NextResponse } from 'next/server';
import { fetchFeed } from '@/lib/gtfsRealtime';
import { getOpenFeedGap } from '@/lib/ledger';

const KTMB_URL =
  'https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb';

export async function GET() {
  const { vehicles, stale, fetchedAt, message } = await fetchFeed(KTMB_URL);
  // Zero trains is ambiguous by itself - "genuinely no service right now"
  // and "data.gov.my's feed is down" look identical otherwise.
  const feedGap = vehicles.length === 0 ? await getOpenFeedGap('ktmb') : null;
  return NextResponse.json(
    { vehicles, stale, ...(message ? { message } : {}), ...(feedGap ? { feedGap } : {}) },
    { status: fetchedAt === 0 ? 503 : 200 },
  );
}
