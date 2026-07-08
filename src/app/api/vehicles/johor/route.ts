import { NextResponse } from 'next/server';
import { fetchFeed } from '@/lib/gtfsRealtime';

const MYBAS_URL =
  'https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-johor';

export async function GET() {
  const { vehicles, stale, fetchedAt, message } = await fetchFeed(MYBAS_URL);
  return NextResponse.json(
    { vehicles, stale, ...(message ? { message } : {}) },
    { status: fetchedAt === 0 ? 503 : 200 },
  );
}
