-- =============================================================================
-- TransitMY - Phase 5 Migration: The Delay Ledger + Trust Core RPCs
-- Apply in: Supabase → SQL Editor → New query → Run
--
-- One pipeline, many features. A snapshot job (Vercel cron and/or opportunistic
-- sampling on /api/pulse traffic) diffs GTFS-realtime observations over time and
-- writes to these tables. Everything downstream reads from them:
--   Daily Delay Report · reliability grades · /status history · Transit Wrapped.
--
-- Changes:
--   1. CREATE TABLE feed_snapshots   - one row per network per sample
--   2. CREATE TABLE vehicle_state    - last-known position per vehicle (stall detection)
--   3. CREATE TABLE delay_events     - the ledger: stall / feed_outage / service_gap
--   4. RLS: snapshots + events publicly readable; vehicle_state service-role only
--   5. CREATE INDEX stop_times_stop_idx - needed by the new schedule RPCs
--   6. CREATE FUNCTION daily_report      - per-network health for one MYT day
--   7. CREATE FUNCTION last_departures   - last scheduled service tonight at a stop
--   8. CREATE FUNCTION direct_journeys   - A→B direct trips (fixed + frequency-based)
--   9. CREATE FUNCTION transfer_points   - candidate interchange stops for A→B
-- =============================================================================


-- =============================================================================
-- 1. feed_snapshots - one row per network each time the sampler runs
-- =============================================================================

CREATE TABLE IF NOT EXISTS feed_snapshots (
  id                BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  network           TEXT        NOT NULL,   -- 'ktmb' | 'rapid-bus-kl' | 'mybas-johor'
  taken_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  vehicle_count     INT         NOT NULL,
  upstream_ok       BOOLEAN     NOT NULL,   -- false = data.gov.my fetch failed
  avg_data_age_secs INT                     -- avg(now − vehicle.timestamp); feed lag
);

CREATE INDEX IF NOT EXISTS feed_snapshots_net_time_idx
  ON feed_snapshots (network, taken_at DESC);


-- =============================================================================
-- 2. vehicle_state - sampler working memory for stall detection
-- =============================================================================
-- Not public. One row per (network, vehicle). The sampler compares the incoming
-- position against this row: moved > ~40 m resets last_moved_at; a vehicle that
-- hasn't moved past the threshold window opens a 'stall' event.

CREATE TABLE IF NOT EXISTS vehicle_state (
  network       TEXT        NOT NULL,
  vehicle_id    TEXT        NOT NULL,
  lat           FLOAT8      NOT NULL,
  lon           FLOAT8      NOT NULL,
  route_id      TEXT,
  last_moved_at TIMESTAMPTZ NOT NULL,
  last_seen_at  TIMESTAMPTZ NOT NULL,
  open_event_id BIGINT,                    -- delay_events.id while a stall is open
  PRIMARY KEY (network, vehicle_id)
);


-- =============================================================================
-- 3. delay_events - the ledger itself
-- =============================================================================
-- Event types (all observed, never inferred from schedules we can't verify):
--   'stall'       - a live vehicle stopped moving mid-service beyond threshold
--   'feed_outage' - data.gov.my upstream failed while we were sampling
--   'service_gap' - zero vehicles reported during service hours, feed healthy
--
-- ended_at IS NULL means the event is still open.

CREATE TABLE IF NOT EXISTS delay_events (
  id         BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  network    TEXT        NOT NULL,
  event_type TEXT        NOT NULL CHECK (event_type IN ('stall', 'feed_outage', 'service_gap')),
  vehicle_id TEXT,
  route_id   TEXT,
  lat        FLOAT8,
  lon        FLOAT8,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at   TIMESTAMPTZ,
  details    JSONB
);

CREATE INDEX IF NOT EXISTS delay_events_net_time_idx
  ON delay_events (network, started_at DESC);

CREATE INDEX IF NOT EXISTS delay_events_open_idx
  ON delay_events (network, event_type)
  WHERE ended_at IS NULL;


-- =============================================================================
-- 4. Row Level Security
-- =============================================================================
-- Radical transparency: the ledger is publicly readable. Writes only ever come
-- from the service role (which bypasses RLS), so no INSERT/UPDATE policies.

ALTER TABLE feed_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE delay_events   ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicle_state  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read feed_snapshots" ON feed_snapshots;
CREATE POLICY "public read feed_snapshots"
  ON feed_snapshots FOR SELECT USING (true);

DROP POLICY IF EXISTS "public read delay_events" ON delay_events;
CREATE POLICY "public read delay_events"
  ON delay_events FOR SELECT USING (true);

-- vehicle_state: RLS enabled with no policies = anon sees nothing. Intentional.


-- =============================================================================
-- 5. Index needed by the new schedule RPCs (lookup by stop, not by trip)
-- =============================================================================

CREATE INDEX IF NOT EXISTS stop_times_stop_idx
  ON stop_times (stop_id, network);


-- =============================================================================
-- 6. daily_report - per-network health for one Malaysia-time day
-- =============================================================================
-- Event durations are clipped to the day window so a stall spanning midnight
-- counts the right minutes on each side.

CREATE OR REPLACE FUNCTION daily_report(p_date date DEFAULT NULL)
RETURNS TABLE (
  network        text,
  snapshots      int,
  uptime_pct     numeric,  -- % of samples where upstream answered
  stall_count    int,
  stall_minutes  int,
  gap_minutes    int,
  outage_minutes int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_day   date;
  v_start timestamptz;
  v_end   timestamptz;
BEGIN
  v_day   := COALESCE(p_date, (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date);
  -- Midnight MYT expressed as an absolute instant
  v_start := (v_day::timestamp) AT TIME ZONE 'Asia/Kuala_Lumpur';
  v_end   := v_start + INTERVAL '1 day';

  RETURN QUERY
  WITH nets AS (
    SELECT s.network FROM feed_snapshots s
      WHERE s.taken_at >= v_start AND s.taken_at < v_end
    UNION
    SELECT e.network FROM delay_events e
      WHERE e.started_at < v_end AND COALESCE(e.ended_at, now()) > v_start
  ),
  snap AS (
    SELECT
      s.network,
      COUNT(*)::int AS snapshots,
      ROUND(100.0 * COUNT(*) FILTER (WHERE s.upstream_ok) / COUNT(*), 1) AS uptime_pct
    FROM feed_snapshots s
    WHERE s.taken_at >= v_start AND s.taken_at < v_end
    GROUP BY s.network
  ),
  ev AS (
    SELECT
      e.network,
      COUNT(*) FILTER (WHERE e.event_type = 'stall')::int AS stall_count,
      COALESCE(SUM(
        EXTRACT(EPOCH FROM
          LEAST(COALESCE(e.ended_at, now()), v_end)
          - GREATEST(e.started_at, v_start)
        )
      ) FILTER (WHERE e.event_type = 'stall'), 0)::int AS stall_secs,
      COALESCE(SUM(
        EXTRACT(EPOCH FROM
          LEAST(COALESCE(e.ended_at, now()), v_end)
          - GREATEST(e.started_at, v_start)
        )
      ) FILTER (WHERE e.event_type = 'service_gap'), 0)::int AS gap_secs,
      COALESCE(SUM(
        EXTRACT(EPOCH FROM
          LEAST(COALESCE(e.ended_at, now()), v_end)
          - GREATEST(e.started_at, v_start)
        )
      ) FILTER (WHERE e.event_type = 'feed_outage'), 0)::int AS outage_secs
    FROM delay_events e
    WHERE e.started_at < v_end AND COALESCE(e.ended_at, now()) > v_start
    GROUP BY e.network
  )
  SELECT
    n.network,
    COALESCE(snap.snapshots, 0),
    snap.uptime_pct,
    COALESCE(ev.stall_count, 0),
    (COALESCE(ev.stall_secs, 0)  / 60)::int,
    (COALESCE(ev.gap_secs, 0)    / 60)::int,
    (COALESCE(ev.outage_secs, 0) / 60)::int
  FROM nets n
  LEFT JOIN snap ON snap.network = n.network
  LEFT JOIN ev   ON ev.network   = n.network
  ORDER BY n.network;
END;
$$;


-- =============================================================================
-- 7. last_departures - the last scheduled service tonight at a stop
-- =============================================================================
-- Powers the Last Train Guardian. Same calendar + frequency semantics as
-- upcoming_arrivals (phase 4): fixed trips read arrival_time directly; for
-- frequency-based trips the last instance of a window starts at
-- (end_time − headway), and the arrival at this stop is that instance plus the
-- in-trip offset (stop_template − trip_ref).

CREATE OR REPLACE FUNCTION last_departures(
  p_stop_id text,
  p_network text
)
RETURNS TABLE (
  route_id         text,
  route_short_name text,
  route_color      text,
  route_text_color text,
  trip_headsign    text,
  direction_id     smallint,
  last_time        text,  -- "HH:MM" MYT
  last_secs        int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_dow      int;
  v_svc_std  text;
  v_svc_rail text;
BEGIN
  v_dow      := EXTRACT(DOW FROM now() AT TIME ZONE 'Asia/Kuala_Lumpur')::int;
  v_svc_std  := CASE WHEN v_dow IN (0, 6) THEN 'weekend' ELSE 'weekday' END;
  v_svc_rail := CASE v_dow WHEN 0 THEN '_Sun_' WHEN 6 THEN '_Sat_' ELSE '_MonFri_' END;

  RETURN QUERY
  WITH
  trip_ref AS (
    SELECT
      f.trip_id, f.network,
      MIN(SPLIT_PART(f.start_time, ':', 1)::int * 3600
        + SPLIT_PART(f.start_time, ':', 2)::int * 60) AS ref_secs
    FROM frequencies f
    WHERE f.network = p_network
    GROUP BY f.trip_id, f.network
  ),
  fixed AS (
    SELECT
      trm.route_id, trm.trip_headsign, trm.direction_id,
      (SPLIT_PART(st.arrival_time, ':', 1)::int * 3600
       + SPLIT_PART(st.arrival_time, ':', 2)::int * 60
       + SPLIT_PART(st.arrival_time, ':', 3)::int) AS arr_secs
    FROM stop_times st
    JOIN trip_route_map trm ON trm.trip_id = st.trip_id AND trm.network = st.network
    LEFT JOIN frequencies f ON f.trip_id = st.trip_id AND f.network = st.network
    WHERE st.stop_id = p_stop_id
      AND st.network = p_network
      AND f.trip_id IS NULL
      AND (
        p_network = 'ktmb'
        OR (p_network = 'rapid-rail-kl' AND st.trip_id LIKE '%' || v_svc_rail || '%')
        OR (p_network = 'rapid-bus-kl'  AND st.trip_id LIKE v_svc_std || '%')
      )
  ),
  freq AS (
    SELECT
      trm.route_id, trm.trip_headsign, trm.direction_id,
      -- last instance of the window + in-trip offset to this stop
      (SPLIT_PART(f.end_time, ':', 1)::int * 3600
       + SPLIT_PART(f.end_time, ':', 2)::int * 60
       - f.headway_secs)
      + (SPLIT_PART(st.arrival_time, ':', 1)::int * 3600
         + SPLIT_PART(st.arrival_time, ':', 2)::int * 60
         + SPLIT_PART(st.arrival_time, ':', 3)::int)
      - tref.ref_secs AS arr_secs
    FROM stop_times st
    JOIN trip_route_map trm ON trm.trip_id = st.trip_id AND trm.network = st.network
    JOIN trip_ref tref      ON tref.trip_id = st.trip_id AND tref.network = st.network
    JOIN frequencies f      ON f.trip_id = st.trip_id AND f.network = st.network
    WHERE st.stop_id = p_stop_id
      AND st.network = p_network
      AND (
        (p_network = 'rapid-rail-kl' AND st.trip_id LIKE '%' || v_svc_rail || '%')
        OR (p_network = 'rapid-bus-kl' AND st.trip_id LIKE v_svc_std || '%')
      )
  ),
  merged AS (
    SELECT a.route_id, a.trip_headsign, a.direction_id, MAX(a.arr_secs) AS last_arr
    FROM (SELECT * FROM fixed UNION ALL SELECT * FROM freq) a
    GROUP BY a.route_id, a.trip_headsign, a.direction_id
  )
  SELECT
    m.route_id,
    r.route_short_name,
    r.route_color,
    r.route_text_color,
    m.trip_headsign,
    m.direction_id,
    TO_CHAR(((m.last_arr % 86400) || ' seconds')::interval, 'HH24:MI') AS last_time,
    m.last_arr::int
  FROM merged m
  JOIN routes r ON r.route_id = m.route_id AND r.network = p_network
  ORDER BY m.last_arr DESC;
END;
$$;


-- =============================================================================
-- 8. direct_journeys - A→B on a single trip (the journey planner's core)
-- =============================================================================
-- Joins stop_times to itself: same trip, from-stop sequence < to-stop sequence.
-- Frequency-based trips are expanded exactly like upcoming_arrivals; fixed
-- trips (KTMB) read wall-clock times. p_after_secs lets the planner chain legs
-- ("departures after leg 1 arrives + transfer buffer"); NULL means "now".

CREATE OR REPLACE FUNCTION direct_journeys(
  p_from       text,
  p_to         text,
  p_network    text,
  p_after_secs int DEFAULT NULL,
  p_ahead_min  int DEFAULT 120,
  p_limit      int DEFAULT 6
)
RETURNS TABLE (
  trip_id          text,
  route_id         text,
  route_short_name text,
  route_color      text,
  route_text_color text,
  trip_headsign    text,
  dep_secs         int,
  arr_secs         int,
  dep_time         text,  -- "HH:MM" MYT
  arr_time         text,
  duration_min     int,
  num_stops        int
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_after    int;
  v_dow      int;
  v_svc_std  text;
  v_svc_rail text;
BEGIN
  v_after := COALESCE(
    p_after_secs,
    EXTRACT(EPOCH FROM (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::time)::int
  );
  v_dow      := EXTRACT(DOW FROM now() AT TIME ZONE 'Asia/Kuala_Lumpur')::int;
  v_svc_std  := CASE WHEN v_dow IN (0, 6) THEN 'weekend' ELSE 'weekday' END;
  v_svc_rail := CASE v_dow WHEN 0 THEN '_Sun_' WHEN 6 THEN '_Sat_' ELSE '_MonFri_' END;

  RETURN QUERY
  WITH
  trip_ref AS (
    SELECT
      f.trip_id, f.network,
      MIN(SPLIT_PART(f.start_time, ':', 1)::int * 3600
        + SPLIT_PART(f.start_time, ':', 2)::int * 60) AS ref_secs
    FROM frequencies f
    WHERE f.network = p_network
    GROUP BY f.trip_id, f.network
  ),
  -- Trip pairs serving from → to in order
  pairs AS (
    SELECT
      st1.trip_id,
      (SPLIT_PART(st1.departure_time, ':', 1)::int * 3600
       + SPLIT_PART(st1.departure_time, ':', 2)::int * 60
       + SPLIT_PART(st1.departure_time, ':', 3)::int) AS from_secs,
      (SPLIT_PART(st2.arrival_time, ':', 1)::int * 3600
       + SPLIT_PART(st2.arrival_time, ':', 2)::int * 60
       + SPLIT_PART(st2.arrival_time, ':', 3)::int) AS to_secs,
      (st2.stop_sequence - st1.stop_sequence)::int AS hops
    FROM stop_times st1
    JOIN stop_times st2
      ON  st2.trip_id = st1.trip_id
      AND st2.network = st1.network
      AND st2.stop_sequence > st1.stop_sequence
    WHERE st1.stop_id = p_from
      AND st2.stop_id = p_to
      AND st1.network = p_network
      AND (
        p_network = 'ktmb'
        OR (p_network = 'rapid-rail-kl' AND st1.trip_id LIKE '%' || v_svc_rail || '%')
        OR (p_network = 'rapid-bus-kl'  AND st1.trip_id LIKE v_svc_std || '%')
      )
  ),
  fixed AS (
    SELECT p.trip_id, p.from_secs AS dep, p.to_secs AS arr, p.hops
    FROM pairs p
    LEFT JOIN frequencies f ON f.trip_id = p.trip_id AND f.network = p_network
    WHERE f.trip_id IS NULL
  ),
  freq AS (
    SELECT
      p.trip_id,
      (gs.instance_start + p.from_secs - tref.ref_secs)::int AS dep,
      (gs.instance_start + p.to_secs   - tref.ref_secs)::int AS arr,
      p.hops
    FROM pairs p
    JOIN trip_ref tref ON tref.trip_id = p.trip_id AND tref.network = p_network
    JOIN frequencies f ON f.trip_id = p.trip_id AND f.network = p_network
    CROSS JOIN LATERAL generate_series(
      -- widen the window backwards so trips already underway are still counted
      GREATEST(
        SPLIT_PART(f.start_time, ':', 1)::int * 3600
          + SPLIT_PART(f.start_time, ':', 2)::int * 60,
        v_after - 7200
      )::bigint,
      LEAST(
        SPLIT_PART(f.end_time, ':', 1)::int * 3600
          + SPLIT_PART(f.end_time, ':', 2)::int * 60
          - f.headway_secs,
        v_after + p_ahead_min * 60
      )::bigint,
      f.headway_secs::bigint
    ) AS gs(instance_start)
  )
  SELECT
    a.trip_id,
    trm.route_id,
    r.route_short_name,
    r.route_color,
    r.route_text_color,
    trm.trip_headsign,
    a.dep::int,
    a.arr::int,
    TO_CHAR(((a.dep % 86400) || ' seconds')::interval, 'HH24:MI'),
    TO_CHAR(((a.arr % 86400) || ' seconds')::interval, 'HH24:MI'),
    ((a.arr - a.dep) / 60)::int,
    a.hops
  FROM (SELECT * FROM fixed UNION ALL SELECT * FROM freq) a
  JOIN trip_route_map trm ON trm.trip_id = a.trip_id AND trm.network = p_network
  JOIN routes r           ON r.route_id = trm.route_id AND r.network = p_network
  WHERE a.dep >= v_after
    AND a.dep <= v_after + p_ahead_min * 60
    AND a.arr > a.dep
  ORDER BY a.arr
  LIMIT p_limit;
END;
$$;


-- =============================================================================
-- 9. transfer_points - candidate interchange stops between A and B
-- =============================================================================
-- Pure topology: stops reachable onward from A that can also reach B, ranked by
-- total hop count. The API layer then times each leg with direct_journeys.
-- Intended for rail/KTMB; the bus network is too dense for this to rank well.

CREATE OR REPLACE FUNCTION transfer_points(
  p_from    text,
  p_to      text,
  p_network text,
  p_limit   int DEFAULT 4
)
RETURNS TABLE (
  stop_id   text,
  stop_name text,
  hops      int
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  WITH reach_from AS (
    SELECT st2.stop_id, MIN(st2.stop_sequence - st1.stop_sequence)::int AS hops1
    FROM stop_times st1
    JOIN stop_times st2
      ON  st2.trip_id = st1.trip_id
      AND st2.network = st1.network
      AND st2.stop_sequence > st1.stop_sequence
    WHERE st1.stop_id = p_from AND st1.network = p_network
    GROUP BY st2.stop_id
  ),
  reach_to AS (
    SELECT st1.stop_id, MIN(st2.stop_sequence - st1.stop_sequence)::int AS hops2
    FROM stop_times st1
    JOIN stop_times st2
      ON  st2.trip_id = st1.trip_id
      AND st2.network = st1.network
      AND st2.stop_sequence > st1.stop_sequence
    WHERE st2.stop_id = p_to AND st1.network = p_network
    GROUP BY st1.stop_id
  )
  SELECT s.stop_id, s.stop_name, (a.hops1 + b.hops2) AS hops
  FROM reach_from a
  JOIN reach_to b  ON b.stop_id = a.stop_id
  JOIN stops s     ON s.stop_id = a.stop_id AND s.network = p_network
  WHERE a.stop_id NOT IN (p_from, p_to)
  ORDER BY hops
  LIMIT p_limit;
$$;
