import { NextResponse } from 'next/server';
import { runFloodAlerts } from '@/lib/floodAlerts';

/**
 * Flood push-alert trigger.
 *
 * Hit this every 10-15 min from a Cloudflare Cron Trigger (or any external
 * scheduler, e.g. cron-job.org). Visitor traffic (/api/pulse, /api/floods)
 * also triggers the job, so alerts still flow without one - just less
 * punctually at 3am.
 * Same CRON_SECRET bearer check as /api/cron/snapshot.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const result = await runFloodAlerts(true);
  return NextResponse.json({ ...result, at: new Date().toISOString() });
}
