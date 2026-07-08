import { NextResponse } from 'next/server';
import { takeSnapshot } from '@/lib/ledger';

/**
 * Delay Ledger sampling trigger.
 *
 * Called by Vercel cron (vercel.json) or any external scheduler
 * (e.g. cron-job.org on the free tier). If CRON_SECRET is set, requests
 * must carry `Authorization: Bearer <CRON_SECRET>` — Vercel cron does this
 * automatically when the env var exists.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  await takeSnapshot(true);
  return NextResponse.json({ ok: true, sampledAt: new Date().toISOString() });
}
