import { NextResponse } from 'next/server';
import { fetchFeed } from '@/lib/gtfsRealtime';

const KTMB_URL =
  'https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb';

export async function GET() {
  const { vehicles, stale, fetchedAt, message } = await fetchFeed(KTMB_URL);
  return NextResponse.json(
    { vehicles, stale, ...(message ? { message } : {}) },
    { status: fetchedAt === 0 ? 503 : 200 },
  );
}
