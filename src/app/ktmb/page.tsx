import type { Metadata } from 'next'
import Link from 'next/link'
import { getKtmbSchedule, type KtmbLine } from '@/lib/ktmbSchedule'
import { BrandMark } from '@/components/BrandMark'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Jadual KTM — TransitMY',
  description:
    'Jadual setiap laluan KTM Komuter, ETS dan Intercity — tren pertama, tren akhir dan bilangan stesen, terus daripada GTFS rasmi data.gov.my.',
}

/**
 * /ktmb — the KTM timetable at a glance. One plate per line: first train, last
 * train, station count and services/day, read from the ingested GTFS static
 * feed. Source + freshness are shown in the open, per the radical-transparency
 * positioning — every screen says where the data came from and how fresh it is.
 */

const TRAIN_ICON =
  'M5 11h14M8 4h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3zM8.5 18l-2 3M15.5 18l2 3M9 15h.01M15 15h.01'

function Stat({ label, value, plus }: { label: string; value: string; plus?: boolean }) {
  return (
    <div className="min-w-0">
      <span className="block font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-sage-mute">
        {label}
      </span>
      <span className="mt-1 block font-mono text-[19px] font-bold leading-none tracking-[-0.01em] text-ink-black tabular-nums">
        {value}
        {plus && (
          <sup className="ml-0.5 align-super font-mono text-[10px] font-bold text-sage-mute">+1</sup>
        )}
      </span>
    </div>
  )
}

function LineCard({ line, index }: { line: KtmbLine; index: number }) {
  return (
    <li
      // Staggered entrance — cardEnter (translateY + scale + opacity), fill-mode
      // both so each item stays invisible during its delay. Capped so a long
      // list never front-loads a slow cascade.
      style={{ animation: `cardEnter 260ms var(--ease-out) ${Math.min(index, 8) * 45}ms both` }}
    >
      <div className="plate shadow-plate-sm rounded-2xl p-16">
        {/* Header: colour badge · line name · kind */}
        <div className="flex items-center gap-14">
          <span
            aria-hidden
            className="flex h-40 w-40 shrink-0 items-center justify-center rounded-lg border-2 border-ink-black"
            style={{ backgroundColor: `#${line.color}`, color: `#${line.textColor}` }}
          >
            <svg className="h-20 w-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d={TRAIN_ICON} />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate font-sans text-body font-extrabold leading-tight tracking-[-0.01em] text-ink-black">
              {line.name}
            </h2>
            <p className="mt-0.5 truncate font-sans text-[13px] leading-snug text-sage-mute">
              {line.origin} <span className="text-ink-black">⇄</span> {line.destination}
            </p>
          </div>
          <span className="shrink-0 self-start rounded-full-2 border-2 border-ink-black bg-linen-canvas px-8 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-ink-black">
            {line.kind === 'komuter' ? 'Komuter' : 'Intercity'}
          </span>
        </div>

        {/* Stats: first / last train · stations · services */}
        <div className="mt-14 flex items-end justify-between gap-8 border-t-2 border-dashed border-silver-border pt-14">
          <Stat label="Pertama" value={line.firstTrain} />
          <Stat label="Akhir" value={line.lastTrain} plus={line.lastAfterMidnight} />
          <Stat label="Stesen" value={String(line.stationCount)} />
          <Stat label="Trip/hari" value={String(line.services)} />
        </div>
      </div>
    </li>
  )
}

export default async function KtmbPage() {
  const { lines, fetchedAt, stale, message } = await getKtmbSchedule()

  const updatedLabel =
    fetchedAt > 0
      ? new Date(fetchedAt).toLocaleTimeString('ms-MY', {
          hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur',
        })
      : null

  const komuter = lines.filter(l => l.kind === 'komuter').length
  const intercity = lines.length - komuter

  return (
    <div className="min-h-screen bg-linen-canvas">
      <div className="mx-auto max-w-md px-20 pb-128 lg:max-w-2xl lg:pb-64">

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
          <BrandMark />
        </header>

        {/* ── Hero ── */}
        <div className="pt-26" style={{ animation: 'riseIn 340ms var(--ease-out) both' }}>
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-sage-mute">
            {updatedLabel ? `Dikemas kini ${updatedLabel} MYT` : 'Jadual KTM'}
          </p>
          <h1 className="mt-10 font-sans text-[40px] font-extrabold leading-[1.02] tracking-[-0.03em] text-ink-black">
            Jadual tren
            <br />
            <span className="relative inline-block">
              <span
                aria-hidden
                className="-inset-x-1.5 absolute bottom-0.75 h-[0.42em] origin-left rounded-lg"
                style={{
                  backgroundColor: 'var(--color-lime-spark)',
                  animation: 'highlightIn 380ms var(--ease-out) 300ms both',
                }}
              />
              <span className="relative">KTM.</span>
            </span>
          </h1>
          <p className="mt-14 font-sans text-body-sm leading-relaxed text-sage-mute">
            Tren pertama, tren akhir dan bilangan stesen untuk setiap laluan Komuter,
            ETS &amp; Intercity — terus daripada GTFS rasmi, bukan tekaan.
          </p>
        </div>

        {/* ── Source + freshness (radical transparency) ── */}
        <div className="mt-20 flex flex-wrap items-center gap-8">
          <span className="plate shadow-plate-sm inline-flex items-center rounded-full-2 px-14 py-1.25 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-ink-black">
            Sumber: data.gov.my
          </span>
          {stale && (
            <span
              className="inline-flex items-center rounded-full-2 border-2 border-ink-black px-12 py-1.25 font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-ink-black"
              style={{ backgroundColor: 'var(--color-mustard-pop)' }}
            >
              Data mungkin lewat
            </span>
          )}
        </div>

        {/* ── Buy ticket CTA — the one lime action on this screen, linking out
            to KTMB's own booking portal. Domain shown up front + real
            external-link affordance so it reads as trustworthy, not a scam
            redirect. */}
        <a
          href="https://online.ktmb.com.my/"
          target="_blank"
          rel="noopener noreferrer"
          className="
            pressable mt-20 flex items-center gap-14 rounded-2xl border-2 border-ink-black
            bg-lime-spark p-16 text-ink-black
          "
        >
          <span className="flex h-40 w-40 shrink-0 items-center justify-center rounded-full-3 border-2 border-ink-black bg-white-plate">
            <svg aria-hidden className="h-20 w-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d={TRAIN_ICON} />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-sans text-body font-extrabold leading-tight tracking-[-0.01em]">
              Beli tiket KTM rasmi
            </span>
            <span className="mt-1 flex items-center gap-4 font-mono text-[11px] font-bold text-ink-black/70">
              online.ktmb.com.my
              <svg aria-hidden className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 17L17 7M9 7h8v8" />
              </svg>
            </span>
          </span>
          <span className="shrink-0 rounded-full-2 border-2 border-ink-black bg-white-plate px-10 py-4 font-mono text-[10px] font-bold uppercase tracking-widest">
            Rasmi
          </span>
        </a>

        {/* ── Body ── */}
        {fetchedAt === 0 ? (
          // Total failure with nothing cached — stay honest, never a red crash.
          <div className="mt-26 rounded-2xl border-2 border-ink-black bg-white-plate p-20">
            <p className="font-sans text-body font-bold text-ink-black">
              Jadual tak dapat dimuatkan sekarang.
            </p>
            <p className="mt-8 font-sans text-body-sm leading-relaxed text-sage-mute">
              Sumber jadual di data.gov.my mungkin tumbang. Cuba muat semula sebentar lagi
              — status penuh setiap suapan ada di <Link href="/status" className="underline">/status</Link>.
            </p>
            {message && (
              <p className="mt-10 font-mono text-[11px] text-sage-mute/80">{message}</p>
            )}
          </div>
        ) : lines.length === 0 ? (
          // Empty ≠ error — a calm, plain state.
          <div className="mt-26 rounded-2xl border-2 border-ink-black bg-white-plate p-20">
            <p className="font-sans text-body font-bold text-ink-black">
              Tiada jadual KTM buat masa ini.
            </p>
            <p className="mt-8 font-sans text-body-sm leading-relaxed text-sage-mute">
              Jadual belum dimuat naik ke pangkalan data. Jalankan <span className="font-mono">npm run ingest -- ktmb</span> untuk mengisinya.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-24 flex items-baseline gap-8">
              <span className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-sage-mute">
                {lines.length} laluan
              </span>
              <span className="font-mono text-[11px] text-sage-mute/70">
                · {komuter} Komuter · {intercity} Intercity
              </span>
            </div>
            <ul className="mt-14 space-y-14">
              {lines.map((line, i) => (
                <LineCard key={line.routeId} line={line} index={i} />
              ))}
            </ul>
          </>
        )}

        <p className="mt-26 text-center font-mono text-[10px] font-medium uppercase leading-relaxed tracking-[0.08em] text-sage-mute/80">
          Waktu berjadual MYT · jadual GTFS statik ·
          kedudukan tren langsung di <Link href="/map" className="underline">/map</Link>
        </p>
      </div>
    </div>
  )
}
