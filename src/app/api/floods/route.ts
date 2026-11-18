import { NextResponse, after } from 'next/server';
import { fetchFloodFeed } from '@/lib/floodSource';
import { runFloodAlerts } from '@/lib/floodAlerts';

/**
 * Live river levels + rain gauges from JPS InfoBanjir, trimmed and cached
 * (5 min - the source itself refreshes every 15).
 *
 * Side effect: after responding, opportunistically runs the flood push-alert
 * job (throttled to once per 10 min inside runFloodAlerts).
 */
export async function GET() {
  const feed = await fetchFloodFeed();
  after(() => runFloodAlerts(false));
  return NextResponse.json(feed, {
    status: feed.stations.length === 0 && feed.stale ? 503 : 200,
    headers: { 'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=600' },
  });
}
