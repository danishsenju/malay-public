import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';
import { STATE_BY_CODE } from '@/lib/flood';
import { STRINGS } from '@/lib/strings';
import { parseStates, pushConfigured, sendPush, type SubscriptionRow } from '@/lib/floodAlerts';

/**
 * Flood-alert subscriptions.
 *   POST   { subscription, states, lang, confirm? } - create/update; with
 *          `confirm`, sends a "you're set up" push straight back so the rider
 *          sees on the spot that notifications reach their phone.
 *   DELETE { endpoint } - turn alerts off.
 * No login: the push endpoint itself is the identity (an unguessable URL).
 */

interface Body {
  subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
  endpoint?: string;
  states?: unknown;
  lang?: string;
  confirm?: boolean;
}

// The server POSTs to whatever endpoint it stores, so only the real browser
// push services are accepted - otherwise this route is an open relay.
const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/,                // Chrome, Android, Samsung Internet, Opera
  /^android\.googleapis\.com$/,
  /^web\.push\.apple\.com$/,               // Safari + iOS/iPadOS Home Screen apps
  /^updates\.push\.services\.mozilla\.com$/, // Firefox
  /\.notify\.windows\.com$/,               // Edge on Windows
];

function isPushEndpoint(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 1024) return false;
  try {
    const url = new URL(v);
    return url.protocol === 'https:' && PUSH_HOSTS.some(h => h.test(url.hostname));
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!pushConfigured()) return NextResponse.json({ error: 'push-not-configured' }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as Body;
  const endpoint = body.subscription?.endpoint;
  const p256dh = body.subscription?.keys?.p256dh;
  const auth = body.subscription?.keys?.auth;
  const states = parseStates(body.states);
  if (!isPushEndpoint(endpoint) || !p256dh || !auth || states.length === 0) {
    return NextResponse.json({ error: 'invalid-subscription' }, { status: 400 });
  }

  const row: SubscriptionRow = { endpoint, p256dh, auth, states, lang: body.lang === 'en' ? 'en' : 'ms' };
  const { error } = await getSupabaseAdmin()
    .from('push_subscriptions')
    .upsert({ ...row, updated_at: new Date().toISOString() });
  if (error) return NextResponse.json({ error: 'db-error' }, { status: 500 });

  let confirmed: boolean | undefined;
  if (body.confirm) {
    const s = STRINGS[row.lang];
    confirmed = await sendPush(row, {
      title: s['push.confirmTitle'],
      body: `${s['push.confirmBody']} ${states.map(c => STATE_BY_CODE.get(c)?.short ?? c).join(', ')}.`,
      url: '/weather',
      tag: 'flood-confirm',
    });
  }
  return NextResponse.json({ ok: true, states, confirmed });
}

export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Body;
  if (!isPushEndpoint(body.endpoint)) return NextResponse.json({ error: 'invalid-endpoint' }, { status: 400 });
  await getSupabaseAdmin().from('push_subscriptions').delete().eq('endpoint', body.endpoint);
  return NextResponse.json({ ok: true });
}
