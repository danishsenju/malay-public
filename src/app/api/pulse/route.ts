import { NextResponse, after } from 'next/server';
import { fetchFeed } from '@/lib/gtfsRealtime';
import { LEDGER_NETWORKS, takeSnapshot } from '@/lib/ledger';

/**
 * The Network Pulse — how many vehicles are being tracked live right now,
 * across every feed that publishes positions.
 *
 * Side effect: after responding, opportunistically takes a Delay Ledger
 * snapshot (throttled to ~1/min inside takeSnapshot). On the Vercel free
 * tier, where crons run at most daily, rider traffic itself powers the ledger.
 */
export async function GET() {
  const results = await Promise.all(
    LEDGER_NETWORKS.map(async ({ network, label, url }) => {
      const feed = await fetchFeed(url);
      return {
        network,
        label,
        count: feed.vehicles.length,
        stale: feed.stale,
        fetchedAt: feed.fetchedAt,
      };
    }),
  );

  after(() => takeSnapshot(false));

  return NextResponse.json({
    total: results.reduce((s, r) => s + r.count, 0),
    networks: results,
    takenAt: Date.now(),
  });
}
