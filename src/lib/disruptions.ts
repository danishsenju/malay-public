import { getSupabaseAdmin } from './supabase';
import { NETWORK_LABELS } from './reliability';
import { distanceMeters } from './map';

/**
 * Service disruptions, read straight from the Delay Ledger - never inferred.
 *
 * Only two ledger event types count as a disruption a rider can point to:
 *   stall        a live vehicle stopped moving mid-service for 6+ minutes
 *   service_gap  zero vehicles reported during service hours, feed healthy
 * `feed_outage` is deliberately excluded: data.gov.my going quiet says nothing
 * about whether buses ran, so it is never presented as evidence of lateness.
 *
 * A shareable record has to be TRUE, not merely recorded. The ledger writes
 * what it sees; `credible()` below decides what is safe to hand to a rider as
 * evidence, using the ledger's own history. What it filters, and why:
 *
 *   - Network not STEADILY running at that hour. The ledger assumes 06:00-23:00
 *     for every network, but e.g. myBAS Ipoh is empty from ~22:00 every night
 *     (closing time, not a disruption), and KTM's feed reports zero vehicles in
 *     30-45% of ordinary daytime samples - for KTM "no vehicles" is routine, so
 *     it is never evidence. A gap only counts on a network whose feed is normally
 *     continuous at that hour (vehicles in 80%+ of its own healthy samples, over
 *     28 days). Learnt per network, per hour - not assumed.
 *   - Overnight tails. A gap left open when service ended ("ongoing" for 7
 *     hours) is clamped to the end of that network's normal service window.
 *   - Frozen feed. 3+ stalls on one network within a minute is the signature of
 *     frozen GPS positions, not trains breaking down together (seen 2026-11-18:
 *     five KTM ETS sets "stalled" at the instant the feed recovered).
 *   - Parked vehicles. A "stall" longer than 2 hours is a vehicle out of
 *     service, not a delay; one outside the hours the network runs at all is
 *     parked overnight.
 *   - Terminals and stations. A train sitting within 1.5 km of any station may
 *     be on a scheduled layover or in the yard (seen 2026-11-18: ETS304 "stalled"
 *     31 min, 850 m from JB Sentral - the terminus). The ledger can't tell a
 *     layover from a fault there, so only mid-route stops count. That also drops
 *     real long dwells at a station: we'd rather miss one than accuse a parked
 *     train.
 *   - Noise. Under 10 minutes is a missed sample or a platform pause - buses
 *     come every 10-20 min, so a shorter hole proves nothing.
 *   - Unobserved time. The ledger only samples when riders visit, so the gap
 *     between two samples can be hours. A gap "opened at 22:00, closed at the
 *     next sample at 06:30" is NOT an 8.5-hour outage - nobody was looking. The
 *     duration shown is only the run of consecutive zero-vehicle samples (no
 *     hole over 15 min), and a still-open one is "ongoing" only while its
 *     latest sample is that fresh.
 *   - Duplicates. Overlapping samples can open the same event twice.
 */

export type DisruptionType = 'stall' | 'service_gap';

export interface Disruption {
  id: number;
  network: string;
  networkLabel: string;
  type: DisruptionType;
  routeId: string | null;
  vehicleLabel: string | null;
  startedAt: string;
  /** null = still happening */
  endedAt: string | null;
  /** Length so far (open) or in total (closed), whole minutes. */
  minutes: number;
}

interface EventRow {
  id: number;
  network: string;
  event_type: string;
  route_id: string | null;
  vehicle_id: string | null;
  lat: number | null;
  lon: number | null;
  started_at: string;
  ended_at: string | null;
  details: { label?: string | null } | null;
}

const COLUMNS = 'id, network, event_type, route_id, vehicle_id, lat, lon, started_at, ended_at, details';

// ── Credibility thresholds ──────────────────────────────────────────────────

const MIN_MINUTES = 10;
const MAX_STALL_MINUTES = 120;
/** Two samples further apart than this prove nothing about the time between. */
const MAX_SAMPLE_GAP_MS = 15 * 60_000;
const FROZEN_FEED_MIN_VEHICLES = 3;
const FROZEN_FEED_WINDOW_MS = 60_000;

const HISTORY_DAYS = 28;
// The ledger samples when riders visit, so busy hours are thinly sampled (a
// rush hour can have 4 samples in 28 days). 3 clean samples is enough to read
// an hour; fewer than that is unproven, and unproven is excluded.
const MIN_SAMPLES_PER_HOUR = 3;
/** "Steady": vehicles reported in at least this share of the network's healthy
 *  samples for that hour. A gap is only evidence where the feed is normally
 *  continuous - high on purpose. */
const STEADY_SHARE = 0.8;
/** "Running": vehicles reported at least this often. A stall is about ONE vehicle
 *  that was reporting and stopped, so it only needs the network to be in
 *  service at that hour - it doesn't depend on the feed being continuous. */
const RUNNING_SHARE = 0.2;
const HOURS_TTL_MS = 6 * 3600_000;

const HOUR_MS = 3600_000;
/** Hour of day (0-23) in Malaysia time. MYT is UTC+8, so hour boundaries line up with UTC's. */
const mytHour = (ms: number) => (new Date(ms).getUTCHours() + 8) % 24;

// ── Normal service hours, learnt from the ledger's own history ──────────────

interface ServiceProfile {
  /** MYT hours where the feed normally shows vehicles almost every sample. */
  steady: Set<number>;
  /** MYT hours where the network is in service at all. */
  running: Set<number>;
}

const profileCache = new Map<string, { at: number; profile: ServiceProfile }>();

/** How this network normally behaves hour by hour, from its own history. */
async function serviceProfile(network: string): Promise<ServiceProfile> {
  const hit = profileCache.get(network);
  if (hit && Date.now() - hit.at < HOURS_TTL_MS) return hit.profile;

  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();
  const db = getSupabaseAdmin();
  const buckets = new Map<number, { n: number; running: number }>();

  for (let from = 0; from < 20_000; from += 1000) {
    const { data, error } = await db
      .from('feed_snapshots')
      .select('taken_at, vehicle_count')
      .eq('network', network)
      .eq('upstream_ok', true) // a down feed says nothing about whether buses ran
      .gte('taken_at', since)
      .order('taken_at')
      .range(from, from + 999);
    if (error || !data) break;
    for (const s of data as { taken_at: string; vehicle_count: number }[]) {
      const b = buckets.get(mytHour(Date.parse(s.taken_at))) ?? { n: 0, running: 0 };
      b.n++;
      if (s.vehicle_count > 0) b.running++;
      buckets.set(mytHour(Date.parse(s.taken_at)), b);
    }
    if (data.length < 1000) break;
  }

  // Too few samples in an hour = unproven. We'd rather show no record than a
  // doubtful one.
  const profile: ServiceProfile = { steady: new Set(), running: new Set() };
  for (const [h, b] of buckets) {
    if (b.n < MIN_SAMPLES_PER_HOUR) continue;
    const share = b.running / b.n;
    if (share >= STEADY_SHARE) profile.steady.add(h);
    if (share >= RUNNING_SHARE) profile.running.add(h);
  }
  profileCache.set(network, { at: Date.now(), profile });
  return profile;
}

/**
 * Where this network's normal service window ends, for an event that began at
 * `startMs`: the first hour boundary after it whose hour isn't normal service.
 * null when the event began outside normal service altogether.
 */
export function serviceWindowEnd(startMs: number, hours: Set<number>): number | null {
  if (!hours.has(mytHour(startMs))) return null;
  let cursor = startMs;
  for (let i = 0; i < 24; i++) {
    cursor = (Math.floor(cursor / HOUR_MS) + 1) * HOUR_MS;
    if (!hours.has(mytHour(cursor))) return cursor;
  }
  return startMs + 24 * HOUR_MS; // runs round the clock
}

// ── Evidence-backed duration ────────────────────────────────────────────────

/**
 * How far a service gap is actually EVIDENCED: from `startMs` forward through
 * consecutive zero-vehicle samples of a healthy feed, stopping at the first
 * sample with vehicles, the first feed failure, or the first hole over 15 min.
 * Returns the time of the last confirming sample (>= startMs).
 */
export async function confirmedZeroEnd(network: string, startMs: number, upToMs: number): Promise<number> {
  const { data } = await getSupabaseAdmin()
    .from('feed_snapshots')
    .select('taken_at, vehicle_count, upstream_ok')
    .eq('network', network)
    .gte('taken_at', new Date(startMs - 1000).toISOString())
    .lte('taken_at', new Date(upToMs + 1000).toISOString())
    .order('taken_at')
    .limit(1000);

  let last = startMs;
  for (const s of (data ?? []) as { taken_at: string; vehicle_count: number; upstream_ok: boolean }[]) {
    if (!s.upstream_ok || s.vehicle_count > 0) break;
    const t = Date.parse(s.taken_at);
    if (t - last > MAX_SAMPLE_GAP_MS) break;
    last = Math.max(last, t);
  }
  return last;
}

/** Latest time each still-open stalled vehicle was seen at its stopped position. */
async function lastSeenOpenStalls(rows: EventRow[]): Promise<Map<string, number>> {
  const open = rows.filter(r => r.event_type === 'stall' && r.ended_at === null && r.vehicle_id);
  const seen = new Map<string, number>();
  if (open.length === 0) return seen;
  const { data } = await getSupabaseAdmin()
    .from('vehicle_state')
    .select('network, vehicle_id, last_seen_at')
    .in('vehicle_id', open.map(r => r.vehicle_id!));
  for (const v of (data ?? []) as { network: string; vehicle_id: string; last_seen_at: string }[]) {
    seen.set(`${v.network}|${v.vehicle_id}`, Date.parse(v.last_seen_at));
  }
  return seen;
}

// ── Mid-route check (stalls) ────────────────────────────────────────────────

const STATION_EXCLUSION_M = 1500;
const STATIONS_TTL_MS = 6 * 3600_000;
let stationCache: { at: number; stations: [number, number][] } | null = null;

/** KTM station coordinates. Stalls are only tracked for KTM trains. */
async function ktmStations(): Promise<[number, number][]> {
  if (stationCache && Date.now() - stationCache.at < STATIONS_TTL_MS) return stationCache.stations;
  const { data } = await getSupabaseAdmin().from('stops').select('stop_lat, stop_lon').eq('network', 'ktmb');
  const stations = ((data ?? []) as { stop_lat: number; stop_lon: number }[])
    .filter(s => Number.isFinite(s.stop_lat) && Number.isFinite(s.stop_lon))
    .map(s => [s.stop_lat, s.stop_lon] as [number, number]);
  stationCache = { at: Date.now(), stations };
  return stations;
}

/**
 * True only when we can PROVE the vehicle stopped between stations: it has a
 * plausible Malaysian position (the feed sometimes reports ~0,0) and no
 * station of its network is within 1.5 km. No station list = can't prove it =
 * false.
 */
function stoppedMidRoute(r: EventRow, stations: [number, number][]): boolean {
  if (r.network !== 'ktmb' || stations.length === 0) return false;
  if (r.lat == null || r.lon == null) return false;
  const inMalaysia = r.lat > 0.5 && r.lat < 7.8 && r.lon > 99 && r.lon < 120;
  if (!inMalaysia) return false;
  return !stations.some(([la, lo]) => distanceMeters(r.lat!, r.lon!, la, lo) <= STATION_EXCLUSION_M);
}

// ── Frozen-feed detection ───────────────────────────────────────────────────

/** Ids of stall events that belong to a cluster of 3+ on the same network
 *  within a minute of each other (±60s, so a cluster straddling a minute
 *  boundary can't slip through). */
async function frozenStallIds(rows: EventRow[]): Promise<Set<number>> {
  const byNetwork = new Map<string, EventRow[]>();
  for (const r of rows) {
    if (r.event_type !== 'stall') continue;
    byNetwork.set(r.network, [...(byNetwork.get(r.network) ?? []), r]);
  }

  const frozen = new Set<number>();
  const db = getSupabaseAdmin();
  await Promise.all([...byNetwork].map(async ([network, list]) => {
    const times = list.map(r => Date.parse(r.started_at));
    const { data } = await db
      .from('delay_events')
      .select('started_at')
      .eq('network', network)
      .eq('event_type', 'stall')
      .gte('started_at', new Date(Math.min(...times) - FROZEN_FEED_WINDOW_MS).toISOString())
      .lte('started_at', new Date(Math.max(...times) + FROZEN_FEED_WINDOW_MS).toISOString());
    const all = ((data ?? []) as { started_at: string }[]).map(x => Date.parse(x.started_at));
    for (const r of list) {
      const t = Date.parse(r.started_at);
      if (all.filter(x => Math.abs(x - t) <= FROZEN_FEED_WINDOW_MS).length >= FROZEN_FEED_MIN_VEHICLES) frozen.add(r.id);
    }
  }));
  return frozen;
}

// ── The gate ────────────────────────────────────────────────────────────────

async function credible(rows: EventRow[], now = Date.now()): Promise<Disruption[]> {
  const networks = [...new Set(rows.map(r => r.network))];
  const [frozen, profileList, stations, stallSeen] = await Promise.all([
    frozenStallIds(rows),
    Promise.all(networks.map(async n => [n, await serviceProfile(n)] as const)),
    rows.some(r => r.event_type === 'stall') ? ktmStations() : Promise.resolve([] as [number, number][]),
    lastSeenOpenStalls(rows),
  ]);
  const profileBy = new Map(profileList);
  const none: ServiceProfile = { steady: new Set(), running: new Set() };

  const seen = new Set<string>();
  const out: Disruption[] = [];

  for (const r of rows) {
    if (r.event_type !== 'stall' && r.event_type !== 'service_gap') continue;

    const key = `${r.network}|${r.event_type}|${r.vehicle_id ?? ''}|${r.started_at}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const start = Date.parse(r.started_at);
    const profile = profileBy.get(r.network) ?? none;
    let end = r.ended_at ? Date.parse(r.ended_at) : now;
    let ongoing = r.ended_at === null;

    if (r.event_type === 'stall') {
      if (frozen.has(r.id)) continue;
      if (!profile.running.has(mytHour(start))) continue;
      if (!stoppedMidRoute(r, stations)) continue;
      if (ongoing) {
        // Open: count only up to when the train was last SEEN at that spot.
        const seen = stallSeen.get(`${r.network}|${r.vehicle_id}`);
        if (seen === undefined) continue; // can't evidence it
        end = Math.min(end, seen);
        ongoing = now - seen <= MAX_SAMPLE_GAP_MS;
      }
    } else {
      // A gap is evidence only where the feed is normally continuous.
      const windowEnd = serviceWindowEnd(start, profile.steady);
      if (windowEnd === null) continue;

      // ...and only for as long as consecutive samples actually saw it.
      const confirmed = await confirmedZeroEnd(r.network, start, end);
      const stillSeen = r.ended_at === null && now - confirmed <= MAX_SAMPLE_GAP_MS;
      end = Math.min(confirmed, windowEnd);
      // Open AND fresh AND still inside service hours; otherwise it has ended.
      ongoing = stillSeen && end === confirmed && confirmed < windowEnd;
    }

    const minutes = Math.round((end - start) / 60_000);
    if (minutes < MIN_MINUTES) continue;
    if (r.event_type === 'stall' && minutes > MAX_STALL_MINUTES) continue;

    out.push({
      id: r.id,
      network: r.network,
      networkLabel: NETWORK_LABELS[r.network] ?? r.network,
      type: r.event_type,
      routeId: r.route_id,
      vehicleLabel: r.details?.label ?? r.vehicle_id ?? null,
      startedAt: r.started_at,
      endedAt: ongoing ? null : new Date(end).toISOString(),
      minutes,
    });
  }
  return out;
}

// ── Queries ─────────────────────────────────────────────────────────────────

/** One disruption by ledger id, or null if it doesn't exist / isn't shareable. */
export async function fetchDisruption(id: number): Promise<Disruption | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const { data } = await getSupabaseAdmin().from('delay_events').select(COLUMNS).eq('id', id).maybeSingle();
  if (!data) return null;
  const [d] = await credible([data as EventRow]);
  return d ?? null;
}

/**
 * Disruptions worth showing now: still happening, or ended within
 * `recentHours`. Newest first.
 */
export async function fetchRecentDisruptions({ recentHours = 3, limit = 3 } = {}): Promise<Disruption[]> {
  const sinceMs = Date.now() - recentHours * 3600_000;
  const { data } = await getSupabaseAdmin()
    .from('delay_events')
    .select(COLUMNS)
    .in('event_type', ['stall', 'service_gap'])
    .or(`ended_at.is.null,ended_at.gte.${new Date(sinceMs).toISOString()}`)
    .order('started_at', { ascending: false })
    // Over-fetch: the gate removes rows after the query.
    .limit(limit * 4);
  return (await credible((data ?? []) as EventRow[]))
    // A gap the ledger never closed can clamp to a service window that ended
    // days ago - that's history, not "now".
    .filter(d => d.endedAt === null || Date.parse(d.endedAt) >= sinceMs)
    .slice(0, limit);
}

/** Every disruption that started on a given MYT calendar day (YYYY-MM-DD). */
export async function fetchDisruptionsOn(mytDay: string, limit = 20): Promise<Disruption[]> {
  const start = new Date(`${mytDay}T00:00:00+08:00`).toISOString();
  const end = new Date(Date.parse(start) + 86_400_000).toISOString();
  const { data } = await getSupabaseAdmin()
    .from('delay_events')
    .select(COLUMNS)
    .in('event_type', ['stall', 'service_gap'])
    .gte('started_at', start)
    .lt('started_at', end)
    .order('started_at', { ascending: false })
    .limit(limit * 3);
  return (await credible((data ?? []) as EventRow[])).slice(0, limit);
}
