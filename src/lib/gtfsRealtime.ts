import { transit_realtime } from 'gtfs-realtime-bindings';

export interface Vehicle {
  id: string;
  label?: string;
  routeId?: string;
  tripId?: string;
  lat: number;
  lon: number;
  bearing?: number;
  speed?: number;
  /** Unix timestamp in ms - ready for new Date(v.timestampMs) */
  timestampMs?: number;
  currentStatus?: 'INCOMING_AT' | 'STOPPED_AT' | 'IN_TRANSIT_TO';
  stopId?: string;
}

export interface FeedResult {
  vehicles: Vehicle[];
  stale: boolean;
  /** 0 = never successfully fetched (both cache empty and current fetch failed) */
  fetchedAt: number;
  message?: string;
}

interface CacheEntry {
  vehicles: Vehicle[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 15_000;
const FETCH_TIMEOUT_MS = 8_000;

// Module-level - persists across requests in the same Node.js process.
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<FeedResult>>();

const STOP_STATUS = ['INCOMING_AT', 'STOPPED_AT', 'IN_TRANSIT_TO'] as const;

// protobufjs represents int64/uint64 as Long objects; floats come through as number | null.
function toNum(v: number | { toNumber(): number } | null | undefined): number | undefined {
  if (v == null) return undefined;
  return typeof v === 'number' ? v : v.toNumber();
}

function decodeVehicles(buffer: ArrayBuffer): Vehicle[] {
  const feed = transit_realtime.FeedMessage.decode(new Uint8Array(buffer));
  const out: Vehicle[] = [];

  for (const entity of feed.entity) {
    const v = entity.vehicle;
    if (!v?.position) continue;

    const lat = v.position.latitude;
    const lon = v.position.longitude;
    // Skip entries with no valid coordinates
    if (lat == null || lon == null || (lat === 0 && lon === 0)) continue;

    const tsNum = toNum(v.timestamp);

    out.push({
      id: String(v.vehicle?.id ?? entity.id),
      label: v.vehicle?.label ?? undefined,
      routeId: v.trip?.routeId ?? undefined,
      tripId: v.trip?.tripId ?? undefined,
      lat,
      lon,
      bearing: toNum(v.position.bearing),
      speed: toNum(v.position.speed),
      timestampMs: tsNum != null ? tsNum * 1000 : undefined,
      currentStatus: v.currentStatus != null ? STOP_STATUS[v.currentStatus] : undefined,
      stopId: v.stopId ?? undefined,
    });
  }

  return out;
}

async function doFetch(url: string, cached: CacheEntry | undefined): Promise<FeedResult> {
  const now = Date.now();

  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      cache: 'no-store',
    });

    if (!res.ok) {
      throw new Error(`Upstream ${res.status} ${res.statusText}`);
    }

    const buf = await res.arrayBuffer();
    const vehicles = decodeVehicles(buf);
    cache.set(url, { vehicles, fetchedAt: now });
    return { vehicles, stale: false, fetchedAt: now };
  } catch (err) {
    if (cached) {
      const ageSecs = Math.round((now - cached.fetchedAt) / 1000);
      return {
        vehicles: cached.vehicles,
        stale: true,
        fetchedAt: cached.fetchedAt,
        message: `Showing cached data from ${ageSecs}s ago - live feed unavailable`,
      };
    }

    const reason = err instanceof Error ? err.message : String(err);
    return {
      vehicles: [],
      stale: true,
      fetchedAt: 0,
      message: `No live data right now - ${reason}`,
    };
  }
}

/**
 * Fetches and decodes a GTFS-RT vehicle-position protobuf feed.
 *
 * Behaviour:
 * - Returns in-memory cache if data is < 15 s old (no upstream hit)
 * - On upstream failure, falls back to stale cache if available
 * - Deduplicates concurrent in-flight requests for the same URL
 */
export async function fetchFeed(url: string): Promise<FeedResult> {
  const now = Date.now();
  const cached = cache.get(url);

  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return { vehicles: cached.vehicles, stale: false, fetchedAt: cached.fetchedAt };
  }

  const existing = inflight.get(url);
  if (existing) return existing;

  const promise = doFetch(url, cached).finally(() => inflight.delete(url));
  inflight.set(url, promise);
  return promise;
}
