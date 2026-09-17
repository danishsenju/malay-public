import { NextResponse } from 'next/server';
import { fetchFeed } from '@/lib/gtfsRealtime';
import { getOpenFeedGap } from '@/lib/ledger';

const PRASARANA_BASE =
  'https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana';

const ALLOWED_CATEGORIES = new Set(['rapid-bus-kl', 'rapid-bus-penang', 'rapid-bus-mrtfeeder']);
// Only categories sampled into the delay ledger (see LEDGER_NETWORKS in
// lib/ledger.ts) - a lookup for anything else would just waste a query
// since getOpenFeedGap can never find a row for it.
const LEDGER_TRACKED = new Set(['rapid-bus-kl', 'rapid-bus-penang', 'rapid-bus-mrtfeeder']);

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
  // Zero vehicles is ambiguous by itself - "genuinely no service right now"
  // and "data.gov.my's feed is down" look identical otherwise. Only checked
  // when the list is actually empty, so a healthy feed never pays for it.
  const feedGap = vehicles.length === 0 && LEDGER_TRACKED.has(category)
    ? await getOpenFeedGap(category)
    : null;
  return NextResponse.json(
    { vehicles, stale, ...(message ? { message } : {}), ...(feedGap ? { feedGap } : {}) },
    { status: fetchedAt === 0 ? 503 : 200 },
  );
}
