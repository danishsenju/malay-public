-- =============================================================================
-- TransitMY - Phase 7 Migration: flood push alerts (Cuaca & Banjir page)
-- Apply in: Supabase → SQL Editor → New query → Run
--
-- What this adds
-- ──────────────
--   1. push_subscriptions  - one row per browser/phone that turned alerts on
--   2. flood_alert_state   - what we've already pushed per JPS station, so a
--                            river at Bahaya for 6 hours warns ONCE, not 36x
--   3. job_runs            - atomic "is it my turn?" throttle for the alert
--                            job, which runs from several triggers at once
--
-- All three are service-role only (RLS on, zero policies): push endpoints are
-- capability URLs - anyone holding one can message that phone - so the anon
-- key must never read them. Same stance as vehicle_state in phase 5.
--
-- After applying this SQL, set in .env.local AND in Cloudflare (Workers →
-- your worker → Settings → Variables and Secrets):
--   NEXT_PUBLIC_VAPID_PUBLIC_KEY  - must ALSO be a BUILD variable: NEXT_PUBLIC_*
--                                   values are inlined into the client bundle
--   VAPID_PRIVATE_KEY             - secret
--   VAPID_SUBJECT = https://<your production domain>  (Apple rejects localhost)
-- =============================================================================


-- =============================================================================
-- 1. push_subscriptions
-- =============================================================================
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint     TEXT        PRIMARY KEY,               -- push service URL, unique per device
  p256dh       TEXT        NOT NULL,
  auth         TEXT        NOT NULL,
  states       TEXT[]      NOT NULL DEFAULT '{}',     -- 'SEL', 'WLH', … (lib/flood.ts STATES)
  lang         TEXT        NOT NULL DEFAULT 'ms' CHECK (lang IN ('ms', 'en')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The fan-out query is `states && ARRAY[...]` - GIN makes that an index scan.
CREATE INDEX IF NOT EXISTS push_subscriptions_states_idx
  ON push_subscriptions USING GIN (states);


-- =============================================================================
-- 2. flood_alert_state
-- =============================================================================
-- Only stations we've pushed about live here; a row is deleted when its river
-- has been back to normal for 3h+ (episode over → next rise warns again).
CREATE TABLE IF NOT EXISTS flood_alert_state (
  station_id      TEXT        PRIMARY KEY,
  notified_level  TEXT        NOT NULL CHECK (notified_level IN ('warning', 'danger')),
  notified_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- =============================================================================
-- 3. job_runs
-- =============================================================================
CREATE TABLE IF NOT EXISTS job_runs (
  job     TEXT        PRIMARY KEY,
  ran_at  TIMESTAMPTZ NOT NULL DEFAULT 'epoch'
);

INSERT INTO job_runs (job, ran_at) VALUES ('flood-alerts', 'epoch')
ON CONFLICT (job) DO NOTHING;


-- =============================================================================
-- 4. RLS - service role only
-- =============================================================================
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE flood_alert_state  ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_runs           ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: anon sees nothing, the service role bypasses RLS.
