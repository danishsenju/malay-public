import { PushError, sendWebPush, type VapidKeys } from './webPush'
import { getSupabaseAdmin } from './supabase'
import { fetchFloodFeed } from './floodSource'
import { LEVEL_RANK, STATE_BY_CODE, isStateCode, type FloodLevel, type FloodStation, type StateCode } from './flood'
import { STRINGS } from './strings'
import type { Lang } from './i18n'

/**
 * Flood push alerts - Web Push (VAPID), so one code path serves Android
 * Chrome, desktop browsers and iPhone (iOS 16.4+, only once the PWA is added
 * to the Home Screen - Apple's rule, not ours).
 *
 * We push on ESCALATION only: a river crossing into Amaran (warning) or Bahaya
 * (danger), at most once per level per flood episode. Waspada (alert) is shown
 * in the app but never pushed - at monsoon peak dozens of stations sit there,
 * and an alert channel that cries wolf gets muted. An episode ends when the
 * station is back to normal for 3h+, so a river that rises again later warns
 * again.
 *
 * Runs at most every 10 minutes: from /api/cron/floods (a Cloudflare Cron
 * Trigger or any external scheduler) and opportunistically after /api/pulse +
 * /api/floods responses - the same "rider traffic powers the job" trick the
 * Delay Ledger uses, so alerts still flow with no scheduler at all.
 */

const MIN_INTERVAL_MS = 10 * 60_000
const EPISODE_RESET_MS = 3 * 3600_000
const PUSHABLE: FloodLevel[] = ['warning', 'danger']

let lastRunAt = 0

// ── VAPID ───────────────────────────────────────────────────────────────────

export function pushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
}

function vapidKeys(): VapidKeys {
  return {
    publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    privateKey: process.env.VAPID_PRIVATE_KEY!,
    // Apple's push service rejects localhost subjects - set VAPID_SUBJECT to
    // the production URL (or a mailto:) in every real deployment.
    subject: process.env.VAPID_SUBJECT ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://transitmy.app',
  }
}

// ── Subscriptions ───────────────────────────────────────────────────────────

export interface SubscriptionRow {
  endpoint: string
  p256dh: string
  auth: string
  states: string[]
  lang: Lang
}

export interface PushPayload {
  title: string
  body: string
  url: string
  tag: string
}

/** `status` is the push service's HTTP status (null = we never got an answer). */
export type PushResult = { ok: true } | { ok: false; status: number | null; reason: string }

/** Sends one push; on failure says WHY (and deletes dead subscriptions). */
export async function sendPush(row: SubscriptionRow, payload: PushPayload): Promise<PushResult> {
  try {
    await sendWebPush(row, JSON.stringify(payload), vapidKeys(), { ttlSeconds: 6 * 3600, urgency: 'high' })
    return { ok: true }
  } catch (err) {
    const status = err instanceof PushError ? err.statusCode : null
    const reason = err instanceof Error ? err.message : String(err)
    // 404/410 = the browser dropped this subscription (uninstalled, cleared
    // site data, revoked permission). Forget it so we stop trying.
    if (status === 404 || status === 410) {
      await getSupabaseAdmin().from('push_subscriptions').delete().eq('endpoint', row.endpoint)
    }
    // Shows up in Cloudflare's Workers logs - the first place to look.
    console.error(`[push] send failed (${status ?? 'no response'}): ${reason}`)
    return { ok: false, status, reason }
  }
}

// ── Copy ────────────────────────────────────────────────────────────────────

function levelWord(level: FloodLevel, lang: Lang): string {
  return STRINGS[lang][level === 'danger' ? 'wx.level.danger' : 'wx.level.warning'].toUpperCase()
}

function hhmm(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })
}

export function buildFloodPayload(stations: FloodStation[], lang: Lang): PushPayload {
  const s = STRINGS[lang]
  const sorted = [...stations].sort((a, b) => LEVEL_RANK[b.level!] - LEVEL_RANK[a.level!])
  const states = [...new Set(sorted.map(x => x.state))]
  const url = `/weather?tab=banjir&state=${states[0]}`
  const tag = `flood-${states.sort().join('-')}`

  if (sorted.length === 1) {
    const st = sorted[0]
    const where = `${st.district}, ${STATE_BY_CODE.get(st.state)?.name ?? st.state}`
    return {
      title: `${st.level === 'danger' ? '🔴' : '🟠'} ${levelWord(st.level!, lang)} · ${st.name}`,
      body: `${s['push.level']} ${st.waterLevelM?.toFixed(2)} m (${s['push.threshold']} ${st.thresholdM?.toFixed(2)} m) · ${where} · JPS ${hhmm(st.levelAt)}`,
      url,
      tag,
    }
  }

  const worst = sorted[0].level!
  const list = sorted.slice(0, 3).map(x => `${x.name} (${levelWord(x.level!, lang)})`).join(' · ')
  const more = sorted.length > 3 ? ` +${sorted.length - 3}` : ''
  return {
    title: `${worst === 'danger' ? '🔴' : '🟠'} ${sorted.length} ${s['push.manyTitle']}`,
    body: `${list}${more} · ${s['push.source']}`,
    url,
    tag,
  }
}

// ── The job ─────────────────────────────────────────────────────────────────

interface AlertStateRow {
  station_id: string
  notified_level: FloodLevel
  notified_at: string
}

export interface FloodAlertRun {
  ran: boolean
  reason?: string
  escalations?: number
  sent?: number
}

/** Atomic "is it my turn?" - only one concurrent caller wins the update. */
async function claimRun(db: ReturnType<typeof getSupabaseAdmin>, force: boolean): Promise<'claimed' | 'busy'> {
  const now = new Date()
  const q = db.from('job_runs').update({ ran_at: now.toISOString() }).eq('job', 'flood-alerts')
  const { data, error } = force
    ? await q.select('job')
    : await q.lt('ran_at', new Date(now.getTime() - MIN_INTERVAL_MS).toISOString()).select('job')
  // Say so plainly when the migration hasn't been applied, instead of
  // passing it off as "throttled".
  if (error) throw new Error(`job_runs: ${error.message} (apply supabase/phase7-flood-alerts.sql)`)
  return (data?.length ?? 0) > 0 ? 'claimed' : 'busy'
}

export async function runFloodAlerts(force = false): Promise<FloodAlertRun> {
  if (!pushConfigured()) return { ran: false, reason: 'push not configured' }
  if (!force && Date.now() - lastRunAt < MIN_INTERVAL_MS) return { ran: false, reason: 'throttled' }

  try {
    const db = getSupabaseAdmin()
    if ((await claimRun(db, force)) === 'busy') return { ran: false, reason: 'throttled' }
    lastRunAt = Date.now()

    const feed = await fetchFloodFeed()
    // Never alarm off a cached copy - if JPS is down we say so on the page,
    // we don't re-push yesterday's river.
    if (feed.stale) return { ran: true, reason: 'feed stale - skipped' }

    const { data: stateRows } = await db.from('flood_alert_state').select('station_id, notified_level, notified_at')
    const prev = new Map(((stateRows ?? []) as AlertStateRow[]).map(r => [r.station_id, r]))
    const byId = new Map(feed.stations.map(s => [s.id, s]))
    const now = Date.now()

    // 1. Escalations - a pushable level higher than anything sent this episode.
    const escalated = feed.stations.filter(s => {
      if (!s.level || !PUSHABLE.includes(s.level)) return false
      const p = prev.get(s.id)
      return !p || LEVEL_RANK[s.level] > LEVEL_RANK[p.notified_level]
    })

    // 2. Episodes that are over - back to normal, and not just flickering.
    const ended = [...prev.values()]
      .filter(p => byId.get(p.station_id)?.level === 'normal' && now - Date.parse(p.notified_at) > EPISODE_RESET_MS)
      .map(p => p.station_id)
    if (ended.length > 0) await db.from('flood_alert_state').delete().in('station_id', ended)

    if (escalated.length === 0) return { ran: true, escalations: 0, sent: 0 }

    await db.from('flood_alert_state').upsert(
      escalated.map(s => ({ station_id: s.id, notified_level: s.level, notified_at: new Date(now).toISOString() })),
    )

    // 3. Fan out - one notification per subscriber, covering only their states.
    const states = [...new Set(escalated.map(s => s.state))]
    const { data: subs } = await db
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth, states, lang')
      .overlaps('states', states)

    let sent = 0
    const rows = (subs ?? []) as SubscriptionRow[]
    for (let i = 0; i < rows.length; i += 50) {
      const results = await Promise.all(
        rows.slice(i, i + 50).map(row => {
          const mine = escalated.filter(s => row.states.includes(s.state))
          if (mine.length === 0) return false
          return sendPush(row, buildFloodPayload(mine, row.lang === 'en' ? 'en' : 'ms')).then(r => r.ok)
        }),
      )
      sent += results.filter(Boolean).length
    }
    return { ran: true, escalations: escalated.length, sent }
  } catch (err) {
    // Like the ledger: a broken alert job must never break a user-facing route.
    return { ran: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

export function parseStates(v: unknown): StateCode[] {
  return Array.isArray(v) ? [...new Set(v.filter(isStateCode))] : []
}
