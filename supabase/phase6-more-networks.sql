-- =============================================================================
-- TransitMY - Phase 6 Migration: 9 more networks (Penang, MRT Feeder, Kuching,
-- Melaka, Ipoh, Alor Setar, Kuala Terengganu, Seremban A/B)
-- Apply in: Supabase → SQL Editor → New query → Run
--
-- Why this migration exists
-- ──────────────────────────
-- Every network wired in before this (ktmb, rapid-rail-kl, rapid-bus-kl,
-- mybas-johor) either has no calendar split at all, or encodes it directly in
-- the trip_id string (weekday_/weekend_ prefix, _MonFri_/_Sat_/_Sun_ token).
-- These 9 new networks don't: they use GTFS's actual service_id + calendar.txt
-- mechanism, with real per-network variety -
--   - Alor Setar / Kuala Terengganu / Kuching: plain WEEKDAY / WEEKEND
--   - Melaka: 18 distinct service patterns (ALLDAY, FRISUN, MONWED, ...)
--   - Penang / MRT Feeder: rotating date-stamped service_ids, re-issued every
--     few weeks, each still just a Mon-Thu / Fri / Sat-Sun style split
--   - Ipoh / Seremban A / Seremban B: a single "Bas.my" service whose
--     calendar window is only ONE DAY (regenerated daily at the source) -
--     re-ingest these regularly or their schedule silently goes stale
-- None of that can be string-matched, so this migration adds the real thing:
-- a `calendar` table plus a generic EXISTS-based day-of-week check in
-- upcoming_arrivals, used as a fallback for any network the older hardcoded
-- branches don't already cover. The 4 existing networks are untouched.
--
-- After applying this SQL:
--   npm run ingest -- rapid-bus-penang rapid-bus-mrtfeeder mybas-alor-setar
--     mybas-kuala-terengganu mybas-ipoh mybas-seremban-a mybas-seremban-b
--     mybas-melaka mybas-kuching
--   Then re-apply the geography backfill:
--     UPDATE stops
--     SET location = ST_SetSRID(ST_MakePoint(stop_lon, stop_lat), 4326)::geography;
-- =============================================================================


-- =============================================================================
-- 1. calendar
-- =============================================================================
-- GTFS calendar.txt, verbatim. start_date/end_date as real DATEs so the
-- upcoming_arrivals fallback can range-check them directly.

CREATE TABLE IF NOT EXISTS calendar (
  service_id TEXT    NOT NULL,
  network    TEXT    NOT NULL,
  monday     SMALLINT NOT NULL,
  tuesday    SMALLINT NOT NULL,
  wednesday  SMALLINT NOT NULL,
  thursday   SMALLINT NOT NULL,
  friday     SMALLINT NOT NULL,
  saturday   SMALLINT NOT NULL,
  sunday     SMALLINT NOT NULL,
  start_date DATE     NOT NULL,
  end_date   DATE     NOT NULL,
  PRIMARY KEY (service_id, network)
);


-- =============================================================================
-- 2. trip_route_map.service_id
-- =============================================================================
-- Nullable - only the 9 new networks populate it. Existing rows (ktmb,
-- rapid-rail-kl, rapid-bus-kl, mybas-johor) keep working exactly as before,
-- since their upcoming_arrivals branches never reach the calendar fallback.

ALTER TABLE trip_route_map ADD COLUMN IF NOT EXISTS service_id TEXT;


-- =============================================================================
-- 3. nearby_stops - widen the network whitelist + fix anon access
-- =============================================================================
-- Every other RPC the browser calls directly (upcoming_arrivals,
-- last_departures, direct_journeys, transfer_points) is SECURITY DEFINER -
-- nearby_stops was the one exception, running with the caller's (anon)
-- privileges. That was silently relying on `stops` having no enforced RLS;
-- once RLS actually applied to it, nearby_stops started returning zero rows
-- for every network (old and new alike) since anon has no policy granting it
-- SELECT. Made SECURITY DEFINER here so it bypasses RLS like its siblings,
-- regardless of whatever policy state `stops` ends up in.

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
SECURITY DEFINER
SET search_path = public, extensions
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
  WHERE s.network IN (
    'rapid-rail-kl', 'rapid-bus-kl', 'ktmb', 'mybas-johor',
    'rapid-bus-penang', 'rapid-bus-mrtfeeder', 'mybas-alor-setar',
    'mybas-kuala-terengganu', 'mybas-ipoh', 'mybas-seremban-a',
    'mybas-seremban-b', 'mybas-melaka', 'mybas-kuching'
  )
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
-- 4. upcoming_arrivals - add the generic calendar fallback
-- =============================================================================
-- Identical to the phase4 version, except the `fixed` CTE's network filter
-- gains one more OR branch: a real calendar.txt day-of-week + date-range
-- check, used by any network not already covered by the legacy string
-- patterns. None of the 9 new networks ship frequencies.txt, so they only
-- ever hit the `fixed` CTE - the `freq` CTE naturally returns zero rows for
-- them and needs no changes.

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
  v_now_secs   int;
  v_dow        int;   -- 0=Sun, 1=Mon … 6=Sat  (Malaysia local)
  v_today_date date;
  v_svc_std    text;  -- 'weekday' | 'weekend'   bus prefix
  v_svc_rail   text;  -- '_MonFri_' | '_Sat_' | '_Sun_'   rail embedded token
BEGIN
  -- All time arithmetic in Malaysia Standard Time (UTC+8)
  v_now_secs  := EXTRACT(EPOCH FROM
                   (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::time)::int;
  v_dow       := EXTRACT(DOW FROM
                   now() AT TIME ZONE 'Asia/Kuala_Lumpur')::int;
  v_today_date := (now() AT TIME ZONE 'Asia/Kuala_Lumpur')::date;

  v_svc_std  := CASE WHEN v_dow IN (0, 6) THEN 'weekend' ELSE 'weekday' END;
  v_svc_rail := CASE v_dow
                  WHEN 0 THEN '_Sun_'
                  WHEN 6 THEN '_Sat_'
                  ELSE        '_MonFri_'
                END;

  RETURN QUERY
  WITH

  -- ── Trip reference times for frequency expansion ──────────────────────────
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
            p_network = 'ktmb'           -- numeric trip_ids; always show
            OR p_network = 'mybas-johor' -- single ALLDAY service; always show
            OR (p_network = 'rapid-rail-kl'
                AND st.trip_id LIKE '%' || v_svc_rail || '%')
            OR (p_network = 'rapid-bus-kl'
                AND st.trip_id LIKE v_svc_std || '%')
            -- Generic fallback: real GTFS calendar.txt day-of-week + date
            -- range check, for any network not covered above.
            OR EXISTS (
                 SELECT 1 FROM calendar c
                 WHERE c.service_id = trm.service_id
                   AND c.network    = trm.network
                   AND v_today_date BETWEEN c.start_date AND c.end_date
                   AND (
                         (v_dow = 0 AND c.sunday    = 1) OR
                         (v_dow = 1 AND c.monday    = 1) OR
                         (v_dow = 2 AND c.tuesday   = 1) OR
                         (v_dow = 3 AND c.wednesday = 1) OR
                         (v_dow = 4 AND c.thursday  = 1) OR
                         (v_dow = 5 AND c.friday    = 1) OR
                         (v_dow = 6 AND c.saturday  = 1)
                       )
               )
          )
  ),

  -- ── Frequency-based arrivals ──────────────────────────────────────────────
  freq AS (
    SELECT
      st.trip_id,
      trm.route_id,
      r.route_short_name,
      r.route_color,
      r.route_text_color,
      trm.trip_headsign,
      trm.direction_id,
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
      GREATEST(
        SPLIT_PART(f.start_time, ':', 1)::int * 3600
          + SPLIT_PART(f.start_time, ':', 2)::int * 60,
        v_now_secs - 3600
      )::bigint,
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


-- =============================================================================
-- 5. backfill_stop_geo - reusable geography backfill
-- =============================================================================
-- The stops.location geography column used to require a manual one-off
-- `UPDATE stops SET location = ...` after every ingest run - easy to forget,
-- and forgetting it silently makes a whole network invisible to nearby_stops
-- (which filters on `location IS NOT NULL`). Wrapping it as a callable
-- function lets the ingest script (scripts/ingest-gtfs-static.ts) call it
-- automatically at the end of every run via `db.rpc('backfill_stop_geo')`.
-- Only touches rows missing a location, so it's cheap to call every time.

CREATE OR REPLACE FUNCTION backfill_stop_geo()
RETURNS void
LANGUAGE sql
AS $$
  UPDATE stops
  SET location = ST_SetSRID(ST_MakePoint(stop_lon, stop_lat), 4326)::geography
  WHERE location IS NULL;
$$;

-- Run once now to fix the 9 new networks ingested before this function existed.
SELECT backfill_stop_geo();
