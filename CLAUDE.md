# CLAUDE.md

## Project

Sampai Bila? - a Malaysian live transit tracker PWA (LRT/MRT/Monorail + KTMB + Rapid buses),
built for the Kracked Devs Pasar API bounty.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS
- Supabase (Postgres) - for GTFS static data + daily delay-tracking leaderboard
- Deployed on Vercel

## Design system

ALWAYS read and follow these before writing any UI code:

- .agents/skills/emil-design-eng/SKILL.md
- .agents/skills/animation-vocabulary/SKILL.md
- .agents/skills/review-animations/SKILL.md
- DESIGN.md

These are Emil Kowalski's actual published design/animation skill
files plus our own token doc - treat as authoritative for colors,
typography, motion timing, and voice.
Non-negotiable: Departure Mono for data/digits, Inter for UI text,
only transform/opacity animations, no gradients except the live-position pulse,
no purple-blue AI-slop gradients, no rounded-2xl-shadow-lg-everywhere defaults.

## APIs (data.gov.my - no auth needed)

- KTMB live trains: GET https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb
- Rapid KL/Penang buses: GET https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-kl
- Rapid rail (LRT/MRT/Monorail) static schedule: GET https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl
- myBAS Johor buses (live): GET https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-johor
- myBAS Johor static schedule (Causeway Link, 20 routes): GET https://api.data.gov.my/gtfs-static/mybas-johor
  - Undocumented on the data.gov.my catalogue page - found by testing the URL directly (2026-09-17).
  - Fixed-schedule, no frequencies.txt; every trip uses a single "ALLDAY" calendar
    service (verified against trips.txt), so upcoming_arrivals needs no calendar
    filter for it, same as ktmb.

IMPORTANT: all _-realtime endpoints return raw GTFS-Realtime protobuf
(application/octet-stream), NOT JSON. Must decode with `gtfs-realtime-bindings`.
All _-static endpoints return a ZIP of GTFS CSV files, NOT JSON.
Never write `.json()` on these - it will silently fail or throw.

## Positioning (why we beat MyRapid PULSE)

Every feature must pass this filter: "PULSE tells you what Prasarana wants
you to know; Sampai Bila? tells you the truth, fast, with receipts."

- One app for EVERY network (Rapid + KTMB + myBAS) - PULSE is Rapid-only
- Zero friction: PWA, no login, the link IS the app
- Radical transparency: show data source + freshness on every screen,
  grade our own accuracy in public, admit upstream outages on /status
- We own the HISTORY (delay ledger); official apps only show "now"
- Speed is trust (Emil): instant load + confident motion > authority

## The Delay Ledger (core pipeline - powers all viral features)

One pipeline, many features. A scheduled job diffs GTFS-realtime observations
against the GTFS static schedule and writes rows to a `delay_events` table
in Supabase. Everything downstream reads from it:
Daily Delay Report image · line Reliability Grades (A–F, rolling 30d) ·
personal Delay Receipt share cards · Transit Wrapped · accuracy receipts.
Never compute delays ad-hoc in page code - always read the ledger.

## Feature roadmap (agreed 2026-07-09)

- Phase 1 - Trust core: journey planner (A→B over GTFS static + realtime
  overlay), last-train times + Last Train Guardian, accuracy receipts,
  /status page (upstream API health), BM/EN copy
- Phase 2 - Viral engine: delay ledger pipeline, Daily Delay Report
  (league-table share image), Delay Receipt OG share cards (@vercel/og),
  per-line reliability grades
- Phase 3 - Habit loop: PWA web push (train-approaching / disruption /
  last-train alerts), Smart Commute card (pattern learned on-device in
  localStorage - data never leaves the phone), offline mode (service worker
  caches static schedule; "offline - scheduled times" state), Network Pulse
  ("N trains moving right now" hero with live map dots)
- Phase 4 - Moat: community reports (crowding 🟢🟡🔴, broken lift/escalator,
  feeder-bus no-show) with 30–45 min decay + rate limiting, commuter streaks,
  Transit Wrapped (ship December)

## Voice

Bilingual BM/EN, keep the "Sampai bila?" cheekiness - the app talks like
a Malaysian. Share cards and notifications are written to be screenshotted.

## Architecture decisions already made

- Server-side cache realtime fetches for 15s (rate-limit protection + reduces load)
- On upstream failure, fall back to last cached data and mark it `stale: true` - never show a broken empty state if we have anything to show
- GTFS static (zip) is parsed ONCE via a script into Supabase tables
  (stops, routes, trip_route_map), never fetched live per-request
- Empty vehicle list ≠ error - show "no active trains right now" not a red error state

## Commands

- Dev: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`
