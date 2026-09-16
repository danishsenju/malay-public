/**
 * Client-side live countdown math.
 *
 * The upcoming_arrivals RPC computes minutes_until at FETCH time - between
 * polls that number goes stale ("1 min" stuck on screen while the train has
 * already left). Instead of trusting the snapshot, we recompute minutes from
 * the raw scheduled second-of-day (arr_secs) against a ticking clock, so the
 * flap board counts down in real time and flips to ARR exactly on schedule.
 */

/** Malaysia is UTC+8 with no DST - derive second-of-day in MYT from a UTC
 *  timestamp so the countdown is correct even on a mis-zoned device. */
export function mytSecondsSinceMidnight(nowMs: number): number {
  return Math.floor(nowMs / 1000 + 8 * 3600) % 86_400
}

/**
 * Live minutes until a GTFS arrival. `arrSecs` is seconds since midnight of
 * the service day and may exceed 86400 for post-midnight trips.
 *
 * Returns 0 during the final minute before the scheduled time ("ARR"), and
 * negative once it has passed - callers should drop negative rows.
 */
export function liveMinutesUntil(arrSecs: number, nowMs: number): number {
  const now = mytSecondsSinceMidnight(nowMs)
  let diff = (arrSecs % 86_400) - now
  // More than 6h "in the past" is actually tomorrow (post-midnight service).
  if (diff < -6 * 3600) diff += 86_400
  return Math.floor(diff / 60)
}

/**
 * Human duration - "80 min" reads like an error code; "1 jam 20 min" reads
 * like a person. Under an hour stays plain minutes.
 */
export function formatDuration(totalMin: number, lang: 'ms' | 'en'): string {
  const min = Math.max(0, Math.round(totalMin))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  const hourWord = lang === 'ms' ? 'jam' : h === 1 ? 'hr' : 'hrs'
  return m === 0 ? `${h} ${hourWord}` : `${h} ${hourWord} ${m} min`
}
