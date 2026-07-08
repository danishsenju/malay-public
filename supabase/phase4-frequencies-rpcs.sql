-- =============================================================================
-- Sampai Bila? — Phase 4 Migration
-- Apply in: Supabase → SQL Editor → New query → Run
--
-- Changes:
--   1. CREATE TABLE frequencies  (required for rapid-rail-kl + rapid-bus-kl)
--   2. CREATE FUNCTION nearby_stops   — PostGIS proximity search (all 3 networks)
--   3. CREATE FUNCTION upcoming_arrivals  — departure board data (fixed + freq-based)
--
-- After applying this SQL:
--   Re-run the ingestion script for ALL THREE networks to populate frequencies
--   and the newly-added KTMB trip_route_map rows:
--
--     npm run ingest
--
--   Then re-apply the geography backfill if stops were re-inserted:
--     UPDATE stops
--     SET location = ST_SetSRID(ST_MakePoint(stop_lon, stop_lat), 4326)::geography;
-- =============================================================================


-- =============================================================================
-- 1. frequencies
-- =============================================================================
-- Stores GTFS frequencies.txt. Each row = one headway window for a trip.
-- A trip can have multiple non-overlapping windows (e.g. peak / off-peak).
--
-- rapid-rail-kl: ~106 rows  (100% of trips are frequency-based)
-- rapid-bus-kl:  ~2107 rows (99.9% of trips are frequency-based)
-- ktmb:          zero rows  (ktmb has no frequencies.txt; purely fixed-schedule)

CREATE TABLE IF NOT EXISTS frequencies (
  trip_id      TEXT     NOT NULL,
  network      TEXT     NOT NULL,
  start_time   TEXT     NOT NULL,  -- HH:MM:SS — window open time
  end_time     TEXT     NOT NULL,  -- HH:MM:SS — window close time
  headway_secs INTEGER  NOT NULL,  -- seconds between consecutive trip starts
  exact_times  SMALLINT NOT NULL DEFAULT 0,  -- 0 = approximate, 1 = exact
  PRIMARY KEY (trip_id, network, start_time)
);

CREATE INDEX IF NOT EXISTS frequencies_trip_net_idx
  ON frequencies (trip_id, network);


-- =============================================================================
-- 2. nearby_stops
-- =============================================================================
-- Returns stops within p_radius_m metres of (p_lat, p_lon), ordered by distance.
-- Covers all three networks. rapid-rail-kl has no realtime feed, so the UI
-- renders those cards with isLive = false (no live-dot).

CREATE OR REPLACE FUNCTION nearby_stops(
  p_lat      float8,
  p_lon      float8,
  p_radius_m int     DEFAULT 500,
  p_limit    int     DEFAULT 6
)
RETURNS TABLE (
  stop_id    text,
  stop_name  text,
  network    text,
  stop_lat   float8,
  stop_lon   float8,
  distance_m float8
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    s.stop_id,
    s.stop_name,
    s.network,
    s.stop_lat,
    s.stop_lon,
    ST_Distance(
      s.location,
      ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography
    )::float8 AS distance_m
  FROM stops s
  WHERE s.network IN ('rapid-rail-kl', 'rapid-bus-kl', 'ktmb')
    AND s.location IS NOT NULL
    AND ST_DWithin(
      s.location,
      ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography,
      p_radius_m
    )
  ORDER BY distance_m
  LIMIT p_limit;
$$;


-- =============================================================================
-- 3. upcoming_arrivals
-- =============================================================================
-- Returns the next p_ahead_min minutes of scheduled arrivals at p_stop_id.
--
-- Calendar filtering
-- ──────────────────
-- rapid-rail-kl  trip_ids embed the service period as the 2nd token:
--   AGL_MonFri_0 · AGL_Sat_0 · AGL_Sun_0
--   → filter: trip_id LIKE '%_MonFri_%' | '%_Sat_%' | '%_Sun_%'
--
-- rapid-bus-kl   trip_ids use a prefix:
--   weekday_U6201_... · weekend_U6201_...
--   → filter: trip_id LIKE 'weekday_%' | 'weekend_%'
--
-- ktmb           trip_ids are numeric (26, 27, 2900 …); no calendar prefix.
--   These are intercity trains (ETS) which run 7 days a week.
--   → no filter applied
--
-- Schedule type
-- ─────────────
-- Frequency-based (rapid-rail-kl 100%, rapid-bus-kl 99.9%):
--   actual_arrival = instance_start
--                  + (stop_template_secs − trip_ref_secs)
--   where trip_ref_secs = MIN(frequencies.start_time) for that trip,
--   and instance_start is generated from each frequency window via generate_series.
--
-- Fixed-schedule (ktmb, and 3 rare bus trips):
--   arrival_time from stop_times is the absolute time of day.

CREATE OR REPLACE FUNCTION upcoming_arrivals(
  p_stop_id   text,
  p_network   text,
  p_ahead_min int  DEFAULT 90
)
RETURNS TABLE (
  trip_id          text,
  route_id         text,
  route_short_name text,
  route_color      text,
  route_text_color text,
  trip_headsign    text,
  direction_id     smallint,
  scheduled_time   text,  -- "HH:MM" in Malaysia Standard Time
  minutes_until    int,
  arr_secs         int   -- raw seconds-since-midnight; unique per expanded row, safe as React key
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_now_secs  int;
  v_dow       int;   -- 0=Sun, 1=Mon … 6=Sat  (Malaysia local)
  v_svc_std   text;  -- 'weekday' | 'weekend'   bus prefix
  v_svc_rail  text;  -- '_MonFri_' | '_Sat_' | '_Sun_'   rail embedded token
BEGIN
  -- All time arithmetic in Malaysia Standard Time (UTC+8)
  v_now_secs := EXTRACT(EPOCH FROM
                  (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::time)::int;
  v_dow      := EXTRACT(DOW FROM
                  now() AT TIME ZONE 'Asia/Kuala_Lumpur')::int;

  v_svc_std  := CASE WHEN v_dow IN (0, 6) THEN 'weekend' ELSE 'weekday' END;
  v_svc_rail := CASE v_dow
                  WHEN 0 THEN '_Sun_'
                  WHEN 6 THEN '_Sat_'
                  ELSE        '_MonFri_'
                END;

  RETURN QUERY
  WITH

  -- ── Trip reference times for frequency expansion ──────────────────────────
  -- ref_secs = minimum window start_time across all frequency rows for this trip.
  -- In data.gov.my feeds this equals the first stop's template arrival_time,
  -- so the formula (stop_template − ref_secs) gives the correct in-trip offset.
  trip_ref AS (
    SELECT
      f.trip_id,
      f.network,
      MIN(
        SPLIT_PART(f.start_time, ':', 1)::int * 3600
        + SPLIT_PART(f.start_time, ':', 2)::int * 60
      ) AS ref_secs
    FROM frequencies f
    WHERE f.network = p_network
    GROUP BY f.trip_id, f.network
  ),

  -- ── Fixed-schedule arrivals ───────────────────────────────────────────────
  -- Trips whose trip_id is NOT in the frequencies table.
  -- arrival_time in stop_times is the real wall-clock time.
  fixed AS (
    SELECT
      st.trip_id,
      trm.route_id,
      r.route_short_name,
      r.route_color,
      r.route_text_color,
      trm.trip_headsign,
      trm.direction_id,
      (
        SPLIT_PART(st.arrival_time, ':', 1)::int * 3600
        + SPLIT_PART(st.arrival_time, ':', 2)::int * 60
        + SPLIT_PART(st.arrival_time, ':', 3)::int
      ) AS arr_secs
    FROM stop_times st
    JOIN trip_route_map trm
      ON  trm.trip_id = st.trip_id
      AND trm.network  = st.network
    JOIN routes r
      ON  r.route_id = trm.route_id
      AND r.network   = trm.network
    LEFT JOIN frequencies f
      ON  f.trip_id = st.trip_id
      AND f.network  = st.network
    WHERE st.stop_id  = p_stop_id
      AND st.network  = p_network
      AND f.trip_id   IS NULL   -- absent from frequencies = fixed schedule
      AND (
            p_network = 'ktmb'  -- numeric trip_ids; always show
            OR (p_network = 'rapid-rail-kl'
                AND st.trip_id LIKE '%' || v_svc_rail || '%')
            OR (p_network = 'rapid-bus-kl'
                AND st.trip_id LIKE v_svc_std || '%')
          )
  ),

  -- ── Frequency-based arrivals ──────────────────────────────────────────────
  -- generate_series expands each frequency window into individual trip departures.
  -- We look 1 hour into the past to capture trips that started before now but
  -- haven't yet reached p_stop_id (common for stops late in a long bus route).
  freq AS (
    SELECT
      st.trip_id,
      trm.route_id,
      r.route_short_name,
      r.route_color,
      r.route_text_color,
      trm.trip_headsign,
      trm.direction_id,
      -- actual arrival = trip_instance_start + in-trip offset to this stop
      gs.instance_start
        + (
            SPLIT_PART(st.arrival_time, ':', 1)::int * 3600
            + SPLIT_PART(st.arrival_time, ':', 2)::int * 60
            + SPLIT_PART(st.arrival_time, ':', 3)::int
          )
        - tref.ref_secs AS arr_secs
    FROM stop_times st
    JOIN trip_route_map trm
      ON  trm.trip_id = st.trip_id
      AND trm.network  = st.network
    JOIN routes r
      ON  r.route_id = trm.route_id
      AND r.network   = trm.network
    JOIN trip_ref tref
      ON  tref.trip_id = st.trip_id
      AND tref.network  = st.network
    JOIN frequencies f
      ON  f.trip_id = st.trip_id
      AND f.network  = st.network
    CROSS JOIN LATERAL generate_series(
      -- Start: whichever is later — window open time, or (now − 1 h)
      GREATEST(
        SPLIT_PART(f.start_time, ':', 1)::int * 3600
          + SPLIT_PART(f.start_time, ':', 2)::int * 60,
        v_now_secs - 3600
      )::bigint,
      -- End: whichever is earlier — last valid instance, or (now + ahead_min)
      LEAST(
        SPLIT_PART(f.end_time, ':', 1)::int * 3600
          + SPLIT_PART(f.end_time, ':', 2)::int * 60
          - f.headway_secs,
        v_now_secs + p_ahead_min * 60
      )::bigint,
      f.headway_secs::bigint
    ) AS gs(instance_start)
    WHERE st.stop_id = p_stop_id
      AND st.network = p_network
      AND (
            (p_network = 'rapid-rail-kl'
              AND st.trip_id LIKE '%' || v_svc_rail || '%')
            OR
            (p_network = 'rapid-bus-kl'
              AND st.trip_id LIKE v_svc_std || '%')
          )
  )

  -- ── Merge, filter to upcoming window, top 10 ─────────────────────────────
  SELECT
    a.trip_id,
    a.route_id,
    a.route_short_name,
    a.route_color,
    a.route_text_color,
    a.trip_headsign,
    a.direction_id,
    TO_CHAR((a.arr_secs || ' seconds')::interval, 'HH24:MI') AS scheduled_time,
    ((a.arr_secs - v_now_secs) / 60)::int                   AS minutes_until,
    a.arr_secs::int                                          AS arr_secs
  FROM (
    SELECT * FROM fixed
    UNION ALL
    SELECT * FROM freq
  ) a
  WHERE a.arr_secs >= v_now_secs
    AND a.arr_secs <= v_now_secs + p_ahead_min * 60
  ORDER BY a.arr_secs
  LIMIT 10;

END;
$$;
