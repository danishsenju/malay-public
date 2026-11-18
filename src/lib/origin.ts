import { headers } from 'next/headers';

/**
 * The public origin of THIS request (https://transitmy.example), read from the
 * headers the platform forwards.
 *
 * Why not NEXT_PUBLIC_SITE_URL: chat apps (WhatsApp, Threads, X) fetch the
 * og:image URL themselves, so it must be absolute and public. layout.tsx falls
 * back to http://localhost:3000 when that env var isn't set, which on a live
 * deploy produces og:image URLs nobody can reach - the preview silently never
 * appears. Deriving it from the request makes previews work on any host
 * (Cloudflare, Vercel, a preview URL) with no configuration.
 */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}
