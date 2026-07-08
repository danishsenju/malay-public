'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { SearchOverlay } from '@/components/SearchOverlay'
import { getRailLine } from '@/lib/transit'
import type { JourneyLeg, JourneyOption, JourneyResponse, NearbyStop } from '@/lib/types'

/**
 * Journey planner — A→B over the whole static graph, timed against today's
 * schedule. Direct trips first; one-transfer options when there's no direct
 * ride. Cross-network planning isn't pretended at — we say so.
 */

type PickerTarget = 'from' | 'to' | null

// ── Stop picker row ──────────────────────────────────────────────────────────

function StopPickerRow({
  label, stop, onClick,
}: { label: string; stop: NearbyStop | null; onClick: () => void }) {
  const line = stop?.network === 'rapid-rail-kl' ? getRailLine(stop.stop_id) : null
  return (
    <button
      type="button"
      onClick={onClick}
      className="
        flex w-full items-center gap-14 rounded-2xl px-16 py-14 text-left
        [@media(hover:hover)_and_(pointer:fine)]:hover:bg-leaf-wash/60
        focus:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-band
      "
      style={{ transition: 'background-color 150ms var(--ease-out)' }}
    >
      <span className="w-8.5 shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-sage-mute">
        {label}
      </span>
      {stop ? (
        <span className="flex min-w-0 items-center gap-8">
          {line && (
            <span
              className="h-10 w-10 shrink-0 rounded-full-3 border-2 border-ink-black"
              style={{ backgroundColor: line.color }}
            />
          )}
          <span className="truncate font-sans text-[15px] font-bold text-ink-black">
            {stop.stop_name}
          </span>
        </span>
      ) : (
        <span className="font-sans text-[15px] font-medium text-sage-mute/70">
          Pilih hentian…
        </span>
      )}
    </button>
  )
}

// ── One journey option ───────────────────────────────────────────────────────

function LegChip({ leg }: { leg: JourneyLeg }) {
  return (
    <span
      className="shrink-0 rounded-lg border-2 border-ink-black px-8 py-1 font-mono text-[12px] font-bold leading-none"
      style={{
        backgroundColor: leg.routeColor ? `#${leg.routeColor}` : 'var(--color-cobalt-band)',
        color:           leg.routeTextColor ? `#${leg.routeTextColor}` : '#ffffff',
      }}
    >
      {leg.routeShortName ?? '—'}
    </span>
  )
}

function OptionCard({ option, index }: { option: JourneyOption; index: number }) {
  return (
    <li style={{ animation: `cardEnter 250ms var(--ease-out) ${index * 60}ms both` }}>
      <div className="plate shadow-plate rounded-2xl p-16">
        {/* Times */}
        <div className="flex items-center justify-between gap-14">
          <span className="font-mono text-[26px] font-bold leading-none tracking-[-0.02em] text-ink-black tabular-nums">
            {option.depTime}
            <span className="mx-8 text-sage-mute/50">→</span>
            {option.arrTime}
          </span>
          <span className="shrink-0 rounded-full-2 border-2 border-ink-black bg-lime-spark px-10 py-2 font-mono text-[11px] font-bold text-ink-black tabular-nums">
            {option.totalMin} min
          </span>
        </div>

        {/* Legs */}
        <div className="mt-3 space-y-8">
          {option.legs.map((leg, i) => (
            <div key={i}>
              {i === 1 && option.transferStop && (
                <p className="mb-8 flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-sage-mute">
                  <svg aria-hidden className="h-2.75 w-2.75" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0-4-4m4 4-4 4M16 17H4m0 0 4 4m-4-4 4-4" />
                  </svg>
                  Tukar di {option.transferStop}
                </p>
              )}
              <div className="flex items-center gap-8">
                <LegChip leg={leg} />
                <span className="min-w-0 flex-1 truncate font-sans text-caption font-medium text-midnight-ink/80">
                  {leg.headsign ?? 'Perkhidmatan'}
                </span>
                <span className="shrink-0 font-mono text-[11px] font-medium text-sage-mute tabular-nums">
                  {leg.numStops} hentian
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </li>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PlanPage() {
  const [from, setFrom] = useState<NearbyStop | null>(null)
  const [to, setTo] = useState<NearbyStop | null>(null)
  const [picker, setPicker] = useState<PickerTarget>(null)
  const [result, setResult] = useState<JourneyResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)

  const search = useCallback(async (a: NearbyStop, b: NearbyStop) => {
    setLoading(true)
    setFailed(false)
    setResult(null)
    try {
      const q = new URLSearchParams({
        fromId: a.stop_id, fromNet: a.network,
        toId: b.stop_id, toNet: b.network,
      })
      const res = await fetch(`/api/journey?${q}`)
      if (!res.ok) throw new Error(String(res.status))
      setResult((await res.json()) as JourneyResponse)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  // Search is driven by the events that change the pair — no effect needed.
  function applyStops(nextFrom: NearbyStop | null, nextTo: NearbyStop | null) {
    setFrom(nextFrom)
    setTo(nextTo)
    if (nextFrom && nextTo) search(nextFrom, nextTo)
  }

  function swap() {
    applyStops(to, from)
  }

  const ready = from !== null && to !== null

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

        {/* ── Hero ── */}
        <div className="pt-26" style={{ animation: 'riseIn 340ms var(--ease-out) both' }}>
          <h1 className="font-sans text-[40px] font-extrabold leading-[1.02] tracking-[-0.03em] text-ink-black">
            Rancang
            <br />
            <span className="relative inline-block">
              <span
                aria-hidden
                className="-inset-x-1.5 absolute bottom-0.75 h-[0.42em] origin-left rounded-lg bg-lime-spark"
                style={{ animation: 'highlightIn 380ms var(--ease-out) 300ms both' }}
              />
              <span className="relative">perjalanan.</span>
            </span>
          </h1>
        </div>

        {/* ── From / To picker ── */}
        <div className="mt-24" style={{ animation: 'riseIn 340ms var(--ease-out) 80ms both' }}>
          <div className="plate shadow-plate relative rounded-3xl-2">
            <StopPickerRow label="Dari" stop={from} onClick={() => setPicker('from')} />
            <div className="mx-16 border-t-2 border-dashed border-ink-black/15" />
            <StopPickerRow label="Ke" stop={to} onClick={() => setPicker('to')} />

            {/* Swap — pinned to the seam between the two rows */}
            <button
              type="button"
              aria-label="Tukar arah"
              onClick={swap}
              disabled={!from && !to}
              className="
                plate pressable-sm absolute right-14 top-1/2 flex h-9 w-9 -translate-y-1/2
                items-center justify-center rounded-full-3 bg-lime-spark text-ink-black
                disabled:opacity-40
              "
            >
              <svg aria-hidden className="h-3.75 w-3.75" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4 4 4m6 0v12m0 0 4-4m-4 4-4-4" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── Results ── */}
        <div className="mt-26">
          {!ready && (
            <p className="px-8 text-center font-sans text-body-sm leading-relaxed text-sage-mute">
              Pilih dua hentian dalam rangkaian yang sama — kami cari tren atau
              bas terus, dan cadangkan pertukaran bila tiada laluan terus.
            </p>
          )}

          {loading && (
            <div className="space-y-10">
              <div className="h-27.5 animate-pulse rounded-2xl border-2 border-ink-black/15 bg-concrete-tile/20" />
              <div className="h-27.5 animate-pulse rounded-2xl border-2 border-ink-black/15 bg-concrete-tile/20" />
            </div>
          )}

          {failed && (
            <p className="text-center font-sans text-body-sm text-sage-mute">
              Tak dapat merancang sekarang — cuba sebentar lagi.
            </p>
          )}

          {result && !result.sameNetwork && (
            <div className="rounded-2xl border-2 border-ink-black bg-mustard-pop p-18">
              <p className="font-sans text-body-sm font-bold leading-relaxed text-ink-black">
                Dua hentian ini dalam rangkaian berbeza. Perancangan silang
                rangkaian belum kami sokong — kami tak nak beri anggaran yang
                kami tak yakin. Cuba pilih hentian dalam rangkaian yang sama.
              </p>
            </div>
          )}

          {result && result.sameNetwork && result.options.length === 0 && (
            <p className="text-center font-sans text-body-sm leading-relaxed text-sage-mute">
              Tiada perkhidmatan ditemui dalam 2 jam akan datang —
              mungkin sudah lewat malam, atau laluan ini perlukan lebih
              daripada satu pertukaran.
            </p>
          )}

          {result && result.options.length > 0 && (
            <ol className="space-y-10">
              {result.options.map((o, i) => (
                <OptionCard key={i} option={o} index={i} />
              ))}
            </ol>
          )}

          {result && result.options.length > 0 && (
            <p className="mt-16 text-center font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-sage-mute/80">
              Waktu berjadual · jadual data.gov.my · masa tukar 3 min
            </p>
          )}
        </div>
      </div>

      {/* ── Stop picker overlay (shared search UI) ── */}
      <SearchOverlay
        isOpen={picker !== null}
        onClose={() => setPicker(null)}
        onSelect={stop => {
          if (picker === 'from') applyStops(stop, to)
          if (picker === 'to') applyStops(from, stop)
          setPicker(null)
        }}
      />
    </div>
  )
}
