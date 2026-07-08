import type { Metadata } from 'next'
import Link from 'next/link'
import { getSupabaseAdmin } from '@/lib/supabase'
import { NETWORK_LABELS } from '@/lib/reliability'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Status — Sampai Bila?',
  description:
    'Kesihatan langsung setiap suapan data.gov.my yang kami guna. Bila sumber bermasalah, kami cakap — supaya anda tahu siapa yang patut dipersalahkan.',
}

/**
 * The /status page — the difference between "the app is broken" and
 * "the source is down", in public. When data.gov.my stumbles, users learn
 * to blame the right party. Official apps can't publish this page.
 */

const UPSTREAMS = [
  { name: 'KTMB — kedudukan tren',        url: 'https://api.data.gov.my/gtfs-realtime/vehicle-position/ktmb' },
  { name: 'Rapid KL — kedudukan bas',     url: 'https://api.data.gov.my/gtfs-realtime/vehicle-position/prasarana?category=rapid-bus-kl' },
  { name: 'myBAS Johor — kedudukan bas',  url: 'https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-johor' },
  { name: 'Rapid Rail — jadual statik',   url: 'https://api.data.gov.my/gtfs-static/prasarana?category=rapid-rail-kl' },
]

interface Check {
  name:      string
  ok:        boolean
  latencyMs: number | null
}

async function checkUpstream(name: string, url: string): Promise<Check> {
  const started = Date.now()
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), cache: 'no-store' })
    // Headers are enough for a health check — don't download megabytes of ZIP.
    res.body?.cancel().catch(() => {})
    return { name, ok: res.ok, latencyMs: Date.now() - started }
  } catch {
    return { name, ok: false, latencyMs: null }
  }
}

async function checkSupabase(db: ReturnType<typeof getSupabaseAdmin>): Promise<Check> {
  const started = Date.now()
  const { error } = await db.from('stops').select('stop_id').limit(1)
  return { name: 'Supabase — jadual & lejar', ok: !error, latencyMs: Date.now() - started }
}

function minutesAgo(iso: string): number {
  return Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
}

interface SnapshotRow {
  network: string
  taken_at: string
  vehicle_count: number
  upstream_ok: boolean
}

interface OpenEvent {
  network: string
  event_type: string
  started_at: string
}

function StatusSticker({ ok, latencyMs }: { ok: boolean; latencyMs: number | null }) {
  const slow = ok && latencyMs != null && latencyMs > 3000
  const label = !ok ? 'GAGAL' : slow ? 'PERLAHAN' : 'OK'
  const bg = !ok ? 'var(--color-maroon-plate)' : slow ? 'var(--color-mustard-pop)' : 'var(--color-lime-spark)'
  const text = !ok ? 'var(--color-white-plate)' : 'var(--color-ink-black)'
  return (
    <span
      className="shrink-0 rounded-full-2 border-2 border-ink-black px-10 py-2 font-mono text-[11px] font-bold"
      style={{ backgroundColor: bg, color: text }}
    >
      {label}
    </span>
  )
}

const EVENT_LABEL: Record<string, string> = {
  stall:       'tren tersekat',
  feed_outage: 'suapan terputus',
  service_gap: 'tiada kenderaan dilaporkan',
}

export default async function StatusPage() {
  const db = getSupabaseAdmin()

  const [checks, dbCheck, snapshotsRes, openEventsRes] = await Promise.all([
    Promise.all(UPSTREAMS.map(u => checkUpstream(u.name, u.url))),
    checkSupabase(db),
    db.from('feed_snapshots')
      .select('network, taken_at, vehicle_count, upstream_ok')
      .order('taken_at', { ascending: false })
      .limit(30),
    db.from('delay_events')
      .select('network, event_type, started_at')
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(10),
  ])

  // Latest snapshot per network
  const latest = new Map<string, SnapshotRow>()
  for (const row of (snapshotsRes.data ?? []) as SnapshotRow[]) {
    if (!latest.has(row.network)) latest.set(row.network, row)
  }
  const openEvents = (openEventsRes.data ?? []) as OpenEvent[]
  const allOk = [...checks, dbCheck].every(c => c.ok)
  const checkedAt = new Date().toLocaleTimeString('ms-MY', {
    hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur',
  })

  return (
    <div className="min-h-screen bg-linen-canvas">
      <div className="mx-auto max-w-md px-20 pb-64 lg:max-w-2xl">

        {/* ── Masthead ── */}
        <header className="flex items-center justify-between pt-20">
          <Link
            href="/"
            className="plate pressable-sm flex h-40 w-40 items-center justify-center rounded-full-3 text-ink-black"
            aria-label="Kembali ke laman utama"
          >
            <svg aria-hidden className="h-18 w-18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <span className="font-mono text-body-sm font-bold text-ink-black">Sampai&nbsp;Bila?</span>
        </header>

        {/* ── Hero ── */}
        <div className="pt-26" style={{ animation: 'riseIn 340ms var(--ease-out) both' }}>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-sage-mute">
            Disemak {checkedAt} MYT
          </p>
          <h1 className="mt-10 font-sans text-[40px] font-extrabold leading-[1.02] tracking-[-0.03em] text-ink-black">
            {allOk ? 'Semua sistem' : 'Ada sumber'}
            <br />
            <span className="relative inline-block">
              <span
                aria-hidden
                className="-inset-x-1.5 absolute bottom-0.75 h-[0.42em] origin-left rounded-lg"
                style={{
                  backgroundColor: allOk ? 'var(--color-lime-spark)' : 'var(--color-mustard-pop)',
                  animation: 'highlightIn 380ms var(--ease-out) 300ms both',
                }}
              />
              <span className="relative">{allOk ? 'berjalan.' : 'bermasalah.'}</span>
            </span>
          </h1>
          <p className="mt-14 font-sans text-body-sm leading-relaxed text-sage-mute">
            Kami bukan sumber data — data.gov.my yang siarkan suapan ini.
            Bila ia bermasalah, anda patut tahu bezanya antara &ldquo;aplikasi rosak&rdquo;
            dan &ldquo;sumber tumbang&rdquo;.
          </p>
        </div>

        {/* ── Upstream checks ── */}
        <ul className="mt-26 space-y-10">
          {[...checks, dbCheck].map((c, i) => (
            <li key={c.name} style={{ animation: `cardEnter 250ms var(--ease-out) ${i * 50}ms both` }}>
              <div className="plate shadow-plate-sm flex items-center justify-between gap-14 rounded-2xl p-16">
                <span className="min-w-0">
                  <span className="block truncate font-sans text-body-sm font-bold text-ink-black">
                    {c.name}
                  </span>
                  <span className="mt-2 block font-mono text-[11px] font-medium text-sage-mute tabular-nums">
                    {c.latencyMs != null ? `${c.latencyMs} ms` : 'tiada respons dalam 6s'}
                  </span>
                </span>
                <StatusSticker ok={c.ok} latencyMs={c.latencyMs} />
              </div>
            </li>
          ))}
        </ul>

        {/* ── Ledger: latest samples ── */}
        {latest.size > 0 && (
          <div className="mt-26">
            <span className="plate shadow-plate-sm inline-flex items-center rounded-full-2 px-14 py-1.25 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-ink-black">
              Sampel lejar terkini
            </span>
            <ul className="mt-14 space-y-8">
              {[...latest.values()].map(s => {
                const ageMin = minutesAgo(s.taken_at)
                return (
                  <li
                    key={s.network}
                    className="flex items-center justify-between rounded-2xl border-2 border-ink-black bg-white-plate px-16 py-10"
                  >
                    <span className="font-sans text-caption font-semibold text-ink-black">
                      {NETWORK_LABELS[s.network] ?? s.network}
                    </span>
                    <span className="font-mono text-[11px] font-medium text-sage-mute tabular-nums">
                      {s.vehicle_count} kenderaan · {ageMin} min lalu
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* ── Open incidents ── */}
        {openEvents.length > 0 && (
          <div className="mt-26 rounded-2xl border-2 border-ink-black bg-maroon-plate p-18">
            <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-white-plate/70">
              Insiden terbuka sekarang
            </p>
            <ul className="mt-10 space-y-8">
              {openEvents.map((e, i) => (
                <li key={i} className="flex items-center justify-between gap-10 font-sans text-caption font-semibold text-white-plate">
                  <span>{NETWORK_LABELS[e.network] ?? e.network} — {EVENT_LABEL[e.event_type] ?? e.event_type}</span>
                  <span className="shrink-0 font-mono text-[11px] text-white-plate/70">
                    sejak {new Date(e.started_at).toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="mt-26 text-center font-mono text-[10px] font-medium uppercase leading-relaxed tracking-[0.08em] text-sage-mute/80">
          Semakan langsung setiap kali halaman ini dibuka ·
          lejar kelewatan penuh di <Link href="/report" className="underline">/report</Link>
        </p>
      </div>
    </div>
  )
}
