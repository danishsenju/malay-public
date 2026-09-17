import { fetchFeed, type Vehicle } from './gtfsRealtime';
import { getSupabaseAdmin } from './supabase';

/**
 * The Delay Ledger sampler.
 *
 * Observes every GTFS-realtime feed and writes what it SEES to Supabase -
 * never what a schedule claims. Three event types, all directly observable:
 *
 *   'feed_outage'  - data.gov.my failed to answer
 *   'service_gap'  - feed healthy but zero vehicles during service hours
 *   'stall'        - a KTMB train stopped moving mid-service beyond threshold
 *
 * Runs two ways:
 *   1. Vercel cron → /api/cron/snapshot (every 5 min on paid plans)
 *   2. Opportunistically after /api/pulse traffic (via next/server `after`),
 *      throttled below - so on the free tier, riders power the ledger.
 */

export const LEDGER_NETWORKS = [
  {
    network: 'ktmb',
    label: 'KTM Komuter / ETS',
    url: 'https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb',
    trackStalls: true, // trains shouldn't sit still mid-route
  },
  {
    network: 'rapid-bus-kl',
    label: 'Bas Rapid KL',
    url: 'https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-kl',
    trackStalls: false, // buses idle at terminals/traffic - stall signal too noisy
  },
  {
    network: 'mybas-johor',
    label: 'myBAS Johor',
    url: 'https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-johor',
    trackStalls: false,
  },
  {
    network: 'rapid-bus-penang',
    label: 'Rapid Penang',
    url: 'https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-penang',
    trackStalls: false,
  },
  {
    network: 'rapid-bus-mrtfeeder',
    label: 'Bas Feeder MRT',
    url: 'https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-mrtfeeder',
    trackStalls: false,
  },
  {
    network: 'mybas-alor-setar',
    label: 'myBAS Alor Setar',
    url: 'https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-alor-setar',
    trackStalls: false,
  },
  {
    network: 'mybas-kuala-terengganu',
    label: 'myBAS Kuala Terengganu',
    url: 'https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-kuala-terengganu',
    trackStalls: false,
  },
  {
    network: 'mybas-ipoh',
    label: 'myBAS Ipoh',
    url: 'https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-ipoh',
    trackStalls: false,
  },
  {
    network: 'mybas-seremban-a',
    label: 'myBAS Seremban A',
    url: 'https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-seremban-a',
    trackStalls: false,
  },
  {
    network: 'mybas-seremban-b',
    label: 'myBAS Seremban B',
    url: 'https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-seremban-b',
    trackStalls: false,
  },
  {
    network: 'mybas-melaka',
    label: 'myBAS Melaka',
    url: 'https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-melaka',
    trackStalls: false,
  },
  {
    network: 'mybas-kuching',
    label: 'myBAS Kuching',
    url: 'https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-kuching',
    trackStalls: false,
  },
] as const;

export type LedgerNetwork = (typeof LEDGER_NETWORKS)[number]['network'];

const SNAPSHOT_MIN_INTERVAL_MS = 55_000; // never sample more than ~1/min
const STALL_THRESHOLD_MS = 6 * 60_000;   // unmoved this long = stall event
const MOVE_THRESHOLD_M = 40;             // GPS jitter guard

// Module-level throttle - survives across requests in a warm serverless instance.
let lastSnapshotAt = 0;
let snapshotInflight: Promise<void> | null = null;

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Malaysia local hours during which "zero vehicles" is suspicious. */
function inServiceHours(now = new Date()): boolean {
  const myt = new Date(now.getTime() + 8 * 3600_000); // UTC+8, no DST
  const h = myt.getUTCHours();
  return h >= 6 && h < 23;
}

interface VehicleStateRow {
  network: string;
  vehicle_id: string;
  lat: number;
  lon: number;
  route_id: string | null;
  last_moved_at: string;
  last_seen_at: string;
  open_event_id: number | null;
}

type Admin = ReturnType<typeof getSupabaseAdmin>;

/** Opens an event if none is open for (network, type); returns nothing on error - the ledger is best-effort. */
async function openNetworkEvent(
  db: Admin,
  network: string,
  eventType: 'feed_outage' | 'service_gap',
  details?: Record<string, unknown>,
) {
  const { data: open } = await db
    .from('delay_events')
    .select('id')
    .eq('network', network)
    .eq('event_type', eventType)
    .is('ended_at', null)
    .limit(1);
  if (open && open.length > 0) return;

  await db.from('delay_events').insert({
    network,
    event_type: eventType,
    started_at: new Date().toISOString(),
    details: details ?? null,
  });
}

async function closeNetworkEvents(
  db: Admin,
  network: string,
  eventType: 'feed_outage' | 'service_gap',
) {
  await db
    .from('delay_events')
    .update({ ended_at: new Date().toISOString() })
    .eq('network', network)
    .eq('event_type', eventType)
    .is('ended_at', null);
}

/** Stall detection for one network: diff live positions against vehicle_state. */
async function detectStalls(db: Admin, network: string, vehicles: Vehicle[]) {
  const nowIso = new Date().toISOString();
  const now = Date.now();

  const { data } = await db
    .from('vehicle_state')
    .select('*')
    .eq('network', network);
  const prevById = new Map((data as VehicleStateRow[] | null)?.map(r => [r.vehicle_id, r]) ?? []);

  const upserts: Record<string, unknown>[] = [];
  const eventsToClose: number[] = [];

  for (const v of vehicles) {
    const prev = prevById.get(v.id);
    prevById.delete(v.id); // whatever remains afterwards has vanished from the feed

    if (!prev) {
      upserts.push({
        network, vehicle_id: v.id, lat: v.lat, lon: v.lon,
        route_id: v.routeId ?? null, last_moved_at: nowIso, last_seen_at: nowIso,
        open_event_id: null,
      });
      continue;
    }

    const moved = haversineM(prev.lat, prev.lon, v.lat, v.lon) > MOVE_THRESHOLD_M;

    if (moved) {
      if (prev.open_event_id != null) eventsToClose.push(prev.open_event_id);
      upserts.push({
        network, vehicle_id: v.id, lat: v.lat, lon: v.lon,
        route_id: v.routeId ?? null, last_moved_at: nowIso, last_seen_at: nowIso,
        open_event_id: null,
      });
      continue;
    }

    // Not moving. Long enough to call it a stall?
    const stalledMs = now - new Date(prev.last_moved_at).getTime();
    let openEventId = prev.open_event_id;

    if (openEventId == null && stalledMs > STALL_THRESHOLD_MS) {
      const { data: ev } = await db
        .from('delay_events')
        .insert({
          network,
          event_type: 'stall',
          vehicle_id: v.id,
          route_id: v.routeId ?? null,
          lat: v.lat,
          lon: v.lon,
          started_at: prev.last_moved_at, // the stall began when it stopped moving
          details: { label: v.label ?? null, trip_id: v.tripId ?? null },
        })
        .select('id')
        .single();
      openEventId = (ev as { id: number } | null)?.id ?? null;
    }

    upserts.push({
      network, vehicle_id: v.id, lat: prev.lat, lon: prev.lon,
      route_id: v.routeId ?? prev.route_id, last_moved_at: prev.last_moved_at,
      last_seen_at: nowIso, open_event_id: openEventId,
    });
  }

  // Vehicles that left the feed: close their stalls - we can no longer observe them.
  for (const gone of prevById.values()) {
    if (gone.open_event_id != null) eventsToClose.push(gone.open_event_id);
  }

  if (eventsToClose.length > 0) {
    await db.from('delay_events').update({ ended_at: nowIso }).in('id', eventsToClose);
  }
  if (upserts.length > 0) {
    await db.from('vehicle_state').upsert(upserts, { onConflict: 'network,vehicle_id' });
  }
  // Forget vehicles unseen this round so tomorrow's fleet starts clean.
  const goneIds = [...prevById.keys()];
  if (goneIds.length > 0) {
    await db.from('vehicle_state').delete().eq('network', network).in('vehicle_id', goneIds);
  }
}

/**
 * One full sampling pass across every network. Throttled to ~1/min unless
 * forced (the cron route forces; opportunistic /api/pulse calls don't).
 * All failures are swallowed - the ledger must never break user-facing routes.
 */
export async function takeSnapshot(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastSnapshotAt < SNAPSHOT_MIN_INTERVAL_MS) return;
  if (snapshotInflight) return snapshotInflight;

  snapshotInflight = (async () => {
    try {
      const db = getSupabaseAdmin();

      // Cold-start guard: module state resets per instance, so also check the DB.
      if (!force) {
        const { data: last } = await db
          .from('feed_snapshots')
          .select('taken_at')
          .order('taken_at', { ascending: false })
          .limit(1);
        const lastAt = last?.[0]?.taken_at ? new Date(last[0].taken_at).getTime() : 0;
        if (Date.now() - lastAt < SNAPSHOT_MIN_INTERVAL_MS) {
          lastSnapshotAt = lastAt;
          return;
        }
      }
      lastSnapshotAt = Date.now();

      await Promise.all(
        LEDGER_NETWORKS.map(async ({ network, url, trackStalls }) => {
          const feed = await fetchFeed(url);
          const upstreamOk = !feed.stale;

          const ages = feed.vehicles
            .map(v => (v.timestampMs ? (Date.now() - v.timestampMs) / 1000 : null))
            .filter((a): a is number => a != null && a >= 0 && a < 86_400);
          const avgAge = ages.length > 0
            ? Math.round(ages.reduce((s, a) => s + a, 0) / ages.length)
            : null;

          await db.from('feed_snapshots').insert({
            network,
            vehicle_count: feed.vehicles.length,
            upstream_ok: upstreamOk,
            avg_data_age_secs: avgAge,
          });

          // Feed outage: open while upstream is failing, close on recovery.
          if (!upstreamOk) {
            await openNetworkEvent(db, network, 'feed_outage', { message: feed.message ?? null });
          } else {
            await closeNetworkEvents(db, network, 'feed_outage');

            // Service gap: healthy feed, zero vehicles, during service hours.
            if (feed.vehicles.length === 0 && inServiceHours()) {
              await openNetworkEvent(db, network, 'service_gap');
            } else if (feed.vehicles.length > 0) {
              await closeNetworkEvents(db, network, 'service_gap');
            }

            if (trackStalls && feed.vehicles.length > 0) {
              await detectStalls(db, network, feed.vehicles);
            }
          }
        }),
      );
    } catch {
      // Best-effort by design: a ledger hiccup must never surface to riders.
    } finally {
      snapshotInflight = null;
    }
  })();

  return snapshotInflight;
}

export interface FeedGap {
  eventType: 'feed_outage' | 'service_gap';
  since: string; // ISO timestamp
}

/**
 * Is there a currently-open feed_outage/service_gap for this network? Lets
 * riders be told WHY a route shows zero live vehicles - "upstream feed is
 * down" reads very differently from "no buses right now", and conflating
 * them (as a bare empty vehicle list does) makes riders think service has
 * stopped when it's really just data.gov.my not answering. Best-effort: any
 * failure here must never block the vehicle response itself.
 */
export async function getOpenFeedGap(network: string): Promise<FeedGap | null> {
  try {
    const db = getSupabaseAdmin();
    const { data } = await db
      .from('delay_events')
      .select('event_type, started_at')
      .eq('network', network)
      .in('event_type', ['feed_outage', 'service_gap'])
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1);
    const row = data?.[0] as { event_type: 'feed_outage' | 'service_gap'; started_at: string } | undefined;
    return row ? { eventType: row.event_type, since: row.started_at } : null;
  } catch {
    return null;
  }
}
