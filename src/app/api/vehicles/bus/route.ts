import { NextResponse } from 'next/server';
import { fetchFeed } from '@/lib/gtfsRealtime';

const PRASARANA_BASE =
  'https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana';

const ALLOWED_CATEGORIES = new Set(['rapid-bus-kl', 'rapid-bus-penang']);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category') ?? 'rapid-bus-kl';

  if (!ALLOWED_CATEGORIES.has(category)) {
    return NextResponse.json(
      {
        vehicles: [],
        stale: false,
        message: `Unknown category "${category}". Supported: ${[...ALLOWED_CATEGORIES].join(', ')}`,
      },
      { status: 400 },
    );
  }

  const url = `${PRASARANA_BASE}?category=${encodeURIComponent(category)}`;
  const { vehicles, stale, fetchedAt, message } = await fetchFeed(url);
  return NextResponse.json(
    { vehicles, stale, ...(message ? { message } : {}) },
    { status: fetchedAt === 0 ? 503 : 200 },
  );
}
