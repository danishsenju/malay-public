import { NextResponse } from 'next/server'
import { getKtmbSchedule } from '@/lib/ktmbSchedule'

/**
 * GET /api/ktmb/schedule
 *
 * Clean JSON view of the KTM line timetable, derived from the ingested GTFS
 * static data. This is the endpoint to call - NOT the raw upstream
 * `gtfs-static/ktmb`, which returns a ZIP of CSVs (see src/lib/ktmbSchedule.ts).
 *
 * Production safeguards:
 *   - caching: source is module-cached 6h; response carries CDN cache headers
 *   - upstream failure: falls back to last good data, flags `stale: true`
 *   - total failure (nothing cached): 503 with a message, never a silent throw
 *   - empty result is 200 with `count: 0` - "no lines" is not an error state
 */
export async function GET() {
  const { lines, fetchedAt, stale, message } = await getKtmbSchedule()

  return NextResponse.json(
    {
      source: 'KTMB via data.gov.my - GTFS static (ingested)',
      fetchedAt,
      stale,
      count: lines.length,
      lines,
      ...(message ? { message } : {}),
    },
    {
      status: fetchedAt === 0 ? 503 : 200,
      headers: {
        'Cache-Control': 's-maxage=21600, stale-while-revalidate=86400',
      },
    },
  )
}
