import type { Metadata } from 'next'
import Link from 'next/link'
import { fetchLedgerWindow, gradeRows, mytDate, UNMONITORED_LINES, type NetworkGrade } from '@/lib/reliability'
import { gradeColors } from '@/lib/grades'
import { ShareButton } from '@/components/ShareButton'

export const revalidate = 60

export const metadata: Metadata = {
  title: 'Laporan Harian — Sampai Bila?',
  description:
    'Liga kelewatan pengangkutan awam Malaysia — gred kebolehpercayaan harian untuk KTM dan bas Rapid, dikira daripada data langsung data.gov.my. Dengan resit.',
}

const HARI = ['Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu']
const BULAN = ['Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun', 'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember']

function dateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d)) // calendar date only — weekday is timezone-safe
  return `${HARI[date.getUTCDay()]} · ${d} ${BULAN[m - 1]}`
}

function shareText(grades: NetworkGrade[], dayLabel: string): string {
  const lines = grades
    .filter(g => g.grade !== '—')
    .map(g => `${g.label}: gred ${g.grade} (uptime ${g.uptimePct}%)`)
  const body = lines.length > 0 ? lines.join(' · ') : 'Lejar baru mula merekod — semak semula esok.'
  return `Laporan Harian Sampai Bila? — ${dayLabel}\n${body}\nLRT/MRT? Prasarana tak siarkan kedudukan tren. Kami gred apa yang mereka tunjuk. 🧾`
}

// ── Row: one network in the league table ────────────────────────────────────

function GradeRow({ g, rank, index }: { g: NetworkGrade; rank: number; index: number }) {
  const c = gradeColors(g.grade)
  const noData = g.grade === '—'
  return (
    <li style={{ animation: `cardEnter 250ms var(--ease-out) ${index * 60}ms both` }}>
      <div className="plate shadow-plate flex items-center gap-16 rounded-2xl p-16">
        {/* Rank */}
        <span className="w-20 shrink-0 text-center font-mono text-body-lg font-bold text-sage-mute tabular-nums">
          {rank}
        </span>

        {/* Grade sticker — the loud element of each row */}
        <span
          className="flex h-48 w-48 shrink-0 items-center justify-center rounded-2xl border-2 border-ink-black font-mono text-[24px] font-bold"
          style={{ backgroundColor: c.bg, color: c.text }}
          aria-label={noData ? 'Belum cukup data' : `Gred ${g.grade}`}
        >
          {g.grade}
        </span>

        {/* Facts */}
        <span className="min-w-0 flex-1">
          <span className="block truncate font-sans text-[15px] font-extrabold tracking-[-0.01em] text-ink-black">
            {g.label}
          </span>
          <span className="mt-2 block font-mono text-[11px] font-medium text-sage-mute">
            {noData
              ? `Belum cukup sampel (${g.samples}) — lejar sedang belajar`
              : [
                  `uptime ${g.uptimePct}%`,
                  g.stallCount > 0 ? `${g.stallCount} tren tersekat` : null,
                  g.gapMinutes > 0 ? `${g.gapMinutes} min tiada kenderaan` : null,
                  g.outageMinutes > 0 ? `${g.outageMinutes} min suapan putus` : null,
                ].filter(Boolean).join(' · ') || 'hari yang bersih ✓'}
          </span>
        </span>
      </div>
    </li>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function ReportPage() {
  const today = mytDate()
  const [todayRows, weekRows] = await Promise.all([
    fetchLedgerWindow(1),
    fetchLedgerWindow(7),
  ])
  // Today's raw numbers, graded over 7 days so a single bad hour doesn't
  // whipsaw the letter — grades should move slowly enough to argue about.
  const weekGrades = gradeRows(weekRows, 7)
  const todayByNet = new Map(gradeRows(todayRows, 1).map(g => [g.network, g]))
  const rows = weekGrades.map(g => ({ ...(todayByNet.get(g.network) ?? g), grade: g.grade }))
  const day = dateLabel(today)

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
            {day}
          </p>
          <h1 className="mt-10 font-sans text-[40px] font-extrabold leading-[1.02] tracking-[-0.03em] text-ink-black">
            Laporan
            <br />
            <span className="relative inline-block">
              <span
                aria-hidden
                className="-inset-x-1.5 absolute bottom-0.75 h-[0.42em] origin-left rounded-lg bg-lime-spark"
                style={{ animation: 'highlightIn 380ms var(--ease-out) 300ms both' }}
              />
              <span className="relative">Harian.</span>
            </span>
          </h1>
          <p className="mt-14 font-sans text-body-sm leading-relaxed text-sage-mute">
            Siapa lambat hari ini? Gred dikira daripada suapan langsung data.gov.my —
            bukan kenyataan akhbar. Nombor hari ini, gred purata 7 hari.
          </p>
        </div>

        {/* ── League table ── */}
        <ol className="mt-26 space-y-10">
          {rows.map((g, i) => (
            <GradeRow key={g.network} g={g} rank={i + 1} index={i} />
          ))}
          {rows.length === 0 && (
            <li className="plate rounded-2xl p-20 text-center font-sans text-body-sm text-sage-mute">
              Lejar baru mula merekod. Semak semula sebentar lagi —
              setiap pelawat membantu kami sampel suapan.
            </li>
          )}
        </ol>

        {/* ── The unmonitored callout — say the quiet part loudly ── */}
        <div
          className="mt-16 rounded-2xl border-2 border-ink-black bg-maroon-plate p-18"
          style={{ animation: `cardEnter 250ms var(--ease-out) ${rows.length * 60 + 60}ms both` }}
        >
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-white-plate/70">
            Tidak dipantau
          </p>
          <p className="mt-8 font-sans text-body-sm font-semibold leading-relaxed text-white-plate">
            Prasarana tidak menyiarkan kedudukan tren LRT / MRT / Monorel secara
            langsung. Kami tak boleh gred apa yang mereka tak tunjukkan.
          </p>
          <div className="mt-3 flex flex-wrap gap-8">
            {UNMONITORED_LINES.map(l => (
              <span
                key={l.name}
                className="flex items-center gap-6 rounded-full-2 border-2 border-ink-black bg-white-plate px-10 py-2 font-mono text-[10px] font-bold text-ink-black"
              >
                <span
                  className="h-8 w-8 rounded-full-3 border border-ink-black"
                  style={{ backgroundColor: l.color }}
                />
                {l.name}
              </span>
            ))}
          </div>
        </div>

        {/* ── Share ── */}
        <div className="mt-26 flex justify-center">
          <ShareButton
            title="Laporan Harian — Sampai Bila?"
            text={shareText(rows, day)}
          />
        </div>

        {/* ── Methodology — grade our own homework in public ── */}
        <p className="mt-26 text-center font-mono text-[10px] font-medium uppercase leading-relaxed tracking-[0.08em] text-sage-mute/80">
          Metodologi: kami sampel setiap suapan ± seminit · uptime = % sampel
          upstream menjawab · tren tersekat = tiada pergerakan &gt; 6 minit ·
          lejar penuh boleh disemak di /status
        </p>
      </div>
    </div>
  )
}
