import { NextResponse } from 'next/server';
import { fetchLedgerWindow, gradeRows, UNMONITORED_LINES } from '@/lib/reliability';

/**
 * Rolling reliability grades (default 7 days) from the Delay Ledger.
 * Publicly cached for a minute - grades move slowly by design.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const days = Math.min(30, Math.max(1, parseInt(searchParams.get('days') ?? '7', 10) || 7));

  const rows = await fetchLedgerWindow(days);

  return NextResponse.json(
    {
      days,
      generatedAt: new Date().toISOString(),
      monitored: gradeRows(rows, days),
      unmonitored: UNMONITORED_LINES,
    },
    { headers: { 'Cache-Control': 's-maxage=60, stale-while-revalidate=300' } },
  );
}
