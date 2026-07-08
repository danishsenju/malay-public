import type { Metadata } from 'next'
import Link from 'next/link'
import { ShareButton } from '@/components/ShareButton'

/**
 * The Delay Receipt — a share-first page. The OG image (the actual ticket)
 * is what unfurls on Threads/X; this page is where the sharer lands to hit
 * "Kongsi" and where recipients land to see the live app one tap away.
 */

interface ReceiptParams {
  stop?:  string
  line?:  string
  color?: string
  time?:  string
  mins?:  string
}

function ogUrl(p: ReceiptParams): string {
  const q = new URLSearchParams()
  if (p.stop)  q.set('stop', p.stop.slice(0, 48))
  if (p.line)  q.set('line', p.line.slice(0, 32))
  if (p.color) q.set('color', p.color.slice(0, 6))
  if (p.time)  q.set('time', p.time.slice(0, 5))
  if (p.mins)  q.set('mins', p.mins.slice(0, 3))
  return `/api/og/receipt?${q.toString()}`
}

export async function generateMetadata(
  { searchParams }: { searchParams: Promise<ReceiptParams> },
): Promise<Metadata> {
  const p = await searchParams
  const stop = p.stop?.slice(0, 48) || 'hentian anda'
  const mins = parseInt(p.mins ?? '', 10)
  const title = Number.isFinite(mins)
    ? `${stop} — seterusnya dalam ${Math.max(0, mins)} min · Sampai Bila?`
    : `${stop} · Sampai Bila?`
  return {
    title,
    description: 'Resit perjalanan langsung daripada papan berlepas Sampai Bila? — masa nyata, dengan resit.',
    openGraph: { title, images: [{ url: ogUrl(p), width: 1200, height: 630 }] },
    twitter: { card: 'summary_large_image', images: [ogUrl(p)] },
  }
}

export default async function ReceiptPage(
  { searchParams }: { searchParams: Promise<ReceiptParams> },
) {
  const p = await searchParams
  const stop = p.stop?.slice(0, 48) || 'Hentian anda'
  const line = p.line?.slice(0, 32) ?? ''
  const color = /^[0-9a-fA-F]{6}$/.test(p.color ?? '') ? `#${p.color}` : 'var(--color-cobalt-band)'
  const time = p.time?.slice(0, 5) ?? ''
  const minsNum = parseInt(p.mins ?? '', 10)
  const hasMins = Number.isFinite(minsNum)
  const bigLabel = !hasMins ? '— —' : minsNum <= 0 ? 'TIBA' : `${Math.min(minsNum, 999)} MIN`

  const shareText = hasMins
    ? `Sampai bila? ${stop}: ${minsNum <= 0 ? 'tren dah tiba' : `seterusnya dalam ${minsNum} min`} 🎫`
    : `Sampai bila? ${stop} 🎫`

  return (
    <div className="min-h-screen bg-linen-canvas">
      <div className="mx-auto max-w-md px-20 pb-64">

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

        {/* ── The ticket ── */}
        {/* Entrance animation lives on the wrapper; the tilt lives on the
            plate itself so cardEnter's final transform can't cancel it. */}
        <div
          className="mt-26"
          style={{ animation: 'cardEnter 300ms var(--ease-out) both' }}
        >
          <div className="plate shadow-plate -rotate-1 overflow-hidden rounded-3xl-2">
            {/* Header band */}
            <div className="flex items-center justify-between border-b-2 border-ink-black bg-lime-spark px-18 py-10">
              <span className="font-mono text-[13px] font-bold text-ink-black">SAMPAI BILA?</span>
              <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-ink-black">
                Resit perjalanan
              </span>
            </div>

            {/* Body */}
            <div className="px-18 py-16">
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-sage-mute">
                Hentian
              </p>
              <p className="mt-4 font-sans text-[24px] font-extrabold leading-tight tracking-[-0.02em] text-ink-black">
                {stop}
              </p>

              {line && (
                <span className="mt-10 inline-flex items-center gap-6 rounded-full-2 border-2 border-ink-black bg-white-plate px-10 py-2 font-mono text-[11px] font-bold text-ink-black">
                  <span
                    className="h-8 w-8 rounded-full-3 border border-ink-black"
                    style={{ backgroundColor: color }}
                  />
                  {line}
                </span>
              )}

              <div className="mt-16 border-t-2 border-dashed border-ink-black/20 pt-14">
                <div className="flex items-end justify-between gap-14">
                  <div>
                    <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-sage-mute">
                      Seterusnya dalam
                    </p>
                    <p className="mt-2 font-mono text-[52px] font-bold leading-none tracking-[-0.02em] text-ink-black tabular-nums">
                      {bigLabel}
                    </p>
                  </div>
                  {time && (
                    <div className="pb-2 text-right">
                      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-sage-mute">
                        Dijadualkan
                      </p>
                      <p className="mt-2 font-mono text-[24px] font-bold leading-none text-ink-black tabular-nums">
                        {time}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer: barcode strip */}
            <div className="flex items-center justify-between border-t-2 border-ink-black bg-linen-canvas px-18 py-10">
              <span aria-hidden className="flex gap-0.5">
                {[3, 1, 2, 4, 1, 3, 1, 2, 1, 4, 2, 1, 3, 1, 2].map((w, i) => (
                  <span key={i} className="h-16 bg-ink-black" style={{ width: w * 1.5 }} />
                ))}
              </span>
              <span className="font-mono text-[10px] font-medium text-sage-mute">
                masa nyata · data.gov.my
              </span>
            </div>
          </div>
        </div>

        {/* ── Actions ── */}
        <div className="mt-26 flex flex-col items-center gap-14">
          <ShareButton title={`${stop} · Sampai Bila?`} text={shareText} />
          <Link
            href="/"
            className="plate pressable-sm rounded-full-2 px-18 py-8 font-sans text-[13px] font-bold text-ink-black"
          >
            Semak hentian anda sendiri →
          </Link>
        </div>
      </div>
    </div>
  )
}
