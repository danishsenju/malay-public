import type { Metadata } from 'next'
import Link from 'next/link'
import { fetchLedgerWindow, gradeRows, mytDate, UNMONITORED_LINES, type NetworkGrade } from '@/lib/reliability'
import { gradeColors } from '@/lib/grades'
import { getServerLang, serverT } from '@/lib/serverLang'
import { DAYS, MONTHS } from '@/lib/strings'
import type { Lang } from '@/lib/i18n'
import { ShareButton } from '@/components/ShareButton'
import { BrandMark } from '@/components/BrandMark'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Laporan Harian - TransitMY',
  description:
    'Liga kelewatan pengangkutan awam Malaysia - gred kebolehpercayaan harian untuk KTM dan bas Rapid, dikira daripada data langsung data.gov.my. Dengan resit.',
}

function dateLabel(iso: string, lang: Lang): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d)) // calendar date only - weekday is timezone-safe
  return `${DAYS[lang][date.getUTCDay()]} · ${d} ${MONTHS[lang][m - 1]}`
}

function shareText(grades: NetworkGrade[], dayLabel: string): string {
  const lines = grades
    .filter(g => g.grade !== '-')
    .map(g => `${g.label}: gred ${g.grade} (uptime ${g.uptimePct}%)`)
  const body = lines.length > 0 ? lines.join(' · ') : 'Lejar baru mula merekod - semak semula esok.'
  return `Laporan Harian TransitMY - ${dayLabel}\n${body}\nLRT/MRT? Prasarana tak siarkan kedudukan tren. Kami gred apa yang mereka tunjuk. 🧾`
}

// ── Row: one network in the league table ────────────────────────────────────

function GradeRow({ g, rank, index, t }: { g: NetworkGrade; rank: number; index: number; t: ReturnType<typeof serverT> }) {
  const c = gradeColors(g.grade)
  const noData = g.grade === '-'
  return (
    <li style={{ animation: `cardEnter 250ms var(--ease-out) ${index * 60}ms both` }}>
      <div className="plate shadow-plate flex items-center gap-16 rounded-2xl p-16">
        {/* Rank */}
        <span className="w-20 shrink-0 text-center font-mono text-body-lg font-bold text-sage-mute tabular-nums">
          {rank}
        </span>

        {/* Grade sticker - the loud element of each row */}
        <span
          className="flex h-48 w-48 shrink-0 items-center justify-center rounded-2xl border-2 border-ink-black font-mono text-[24px] font-bold"
          style={{ backgroundColor: c.bg, color: c.text }}
          aria-label={noData ? t('report.noData') : `${t('report.grade')} ${g.grade}`}
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
              ? `${t('report.notEnough')} (${g.samples}) - ${t('report.learning')}`
              : [
                  `uptime ${g.uptimePct}%`,
                  g.stallCount > 0 ? `${g.stallCount} ${t('report.stalled')}` : null,
                  g.gapMinutes > 0 ? `${g.gapMinutes} ${t('report.noVehicles')}` : null,
                  g.outageMinutes > 0 ? `${g.outageMinutes} ${t('report.outage')}` : null,
                ].filter(Boolean).join(' · ') || t('report.cleanDay')}
          </span>
        </span>
      </div>
    </li>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default async function ReportPage() {
  const today = mytDate()
  const [todayRows, weekRows, lang] = await Promise.all([
    fetchLedgerWindow(1),
    fetchLedgerWindow(7),
    getServerLang(),
  ])
  const t = serverT(lang)
  // Today's raw numbers, graded over 7 days so a single bad hour doesn't
  // whipsaw the letter - grades should move slowly enough to argue about.
  const weekGrades = gradeRows(weekRows, 7)
  const todayByNet = new Map(gradeRows(todayRows, 1).map(g => [g.network, g]))
  const rows = weekGrades.map(g => ({ ...(todayByNet.get(g.network) ?? g), grade: g.grade }))
  const day = dateLabel(today, lang)

  return (
    <div className="min-h-screen bg-linen-canvas">
      <div className="mx-auto max-w-md px-20 pb-128 lg:max-w-2xl lg:pb-64">

        {/* ── Masthead ── */}
        <header className="flex items-center justify-between pt-20">
          <Link
            href="/"
            className="plate pressable-sm flex h-40 w-40 items-center justify-center rounded-full-3 text-ink-black"
            aria-label={t('common.backHome')}
          >
            <svg aria-hidden className="h-18 w-18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <BrandMark />
        </header>

        {/* ── Hero ── */}
        <div className="pt-26" style={{ animation: 'riseIn 340ms var(--ease-out) both' }}>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-sage-mute">
            {day}
          </p>
          <h1 className="mt-10 font-sans text-[40px] font-extrabold leading-[1.02] tracking-[-0.03em] text-ink-black">
            {t('report.title.1')}
            <br />
            <span className="relative inline-block">
              <span
                aria-hidden
                className="-inset-x-1.5 absolute bottom-0.75 h-[0.42em] origin-left rounded-lg bg-lime-spark"
                style={{ animation: 'highlightIn 380ms var(--ease-out) 300ms both' }}
              />
              <span className="relative">{t('report.title.2')}</span>
            </span>
          </h1>
          <p className="mt-14 font-sans text-body-sm leading-relaxed text-sage-mute">
            {t('report.intro')}
          </p>
        </div>

        {/* ── League table ── */}
        <ol className="mt-26 space-y-10">
          {rows.map((g, i) => (
            <GradeRow key={g.network} g={g} rank={i + 1} index={i} t={t} />
          ))}
          {rows.length === 0 && (
            <li className="plate rounded-2xl p-20 text-center font-sans text-body-sm text-sage-mute">
              {t('report.empty')}
            </li>
          )}
        </ol>

        {/* ── The unmonitored callout - say the quiet part loudly ── */}
        <div
          className="mt-16 rounded-2xl border-2 border-ink-black bg-maroon-plate p-18"
          style={{ animation: `cardEnter 250ms var(--ease-out) ${rows.length * 60 + 60}ms both` }}
        >
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-white-plate/70">
            {t('report.unmonitored')}
          </p>
          <p className="mt-8 font-sans text-body-sm font-semibold leading-relaxed text-white-plate">
            {t('report.unmonitoredDesc')}
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
            title="Laporan Harian - TransitMY"
            text={shareText(rows, day)}
          />
        </div>

        {/* ── Link out to /status - the receipts behind these grades ── */}
        <Link
          href="/status"
          className="
            plate pressable-sm mt-26 flex items-center justify-between gap-14 rounded-2xl p-16
            [@media(hover:hover)_and_(pointer:fine)]:hover:bg-leaf-wash/60
          "
        >
          <span className="min-w-0">
            <span className="block font-sans text-[15px] font-bold leading-snug text-ink-black">
              {t('report.statusLink')}
            </span>
            <span className="mt-2 block font-mono text-[11px] font-medium text-sage-mute">
              {t('report.statusLinkDesc')}
            </span>
          </span>
          <span className="flex h-40 w-40 shrink-0 items-center justify-center rounded-full-3 border-2 border-ink-black bg-lime-spark text-ink-black">
            <svg aria-hidden className="h-18 w-18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </span>
        </Link>

        {/* ── Methodology - grade our own homework in public ── */}
        <p className="mt-26 text-center font-mono text-[10px] font-medium uppercase leading-relaxed tracking-[0.08em] text-sage-mute/80">
          {t('report.methodology')}{' '}
          <Link href="/status" className="underline">/status</Link>
        </p>
      </div>
    </div>
  )
}
