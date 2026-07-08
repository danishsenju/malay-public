'use client'

import useSWR from 'swr'
import { FlapDigit } from './FlapDigit'

interface PulseNetwork {
  network:   string
  label:     string
  count:     number
  stale:     boolean
  fetchedAt: number
}

interface PulseResponse {
  total:    number
  networks: PulseNetwork[]
  takenAt:  number
}

const SHORT_LABEL: Record<string, string> = {
  'ktmb':         'KTM',
  'rapid-bus-kl': 'Bas KL',
  'mybas-johor':  'Johor',
}

async function fetchPulse(url: string): Promise<PulseResponse> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} → ${res.status}`)
  return res.json() as Promise<PulseResponse>
}

/**
 * The Network Pulse — "N vehicles tracked live right now" as a departure-board
 * counter. The count arrives via SWR every 15s; digit changes ride the same
 * split-flap mechanism as arrival countdowns, so the whole app speaks one
 * motion language. Data-driven flips are state indication, not decoration.
 */
export function NetworkPulse() {
  const { data, error } = useSWR<PulseResponse>('/api/pulse', fetchPulse, {
    refreshInterval: 15_000,
    revalidateOnFocus: false,
  })

  const loading = !data && !error
  const total = data?.total ?? 0
  const anyLive = (data?.networks ?? []).some(n => n.count > 0 && !n.stale)
  // Fixed 3-char field keeps digit positions (and React keys) stable, exactly
  // like FlapCountdown — the same DOM nodes flip between values.
  const display = loading ? '···' : String(Math.min(total, 999)).padStart(3, ' ')

  return (
    <div className="plate shadow-plate rounded-3xl-2 px-20 py-18">
      {/* Eyebrow */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-sage-mute">
          Denyut rangkaian
        </span>
        {anyLive && (
          <span className="flex items-center gap-1.75" aria-hidden>
            <span className="relative flex h-1.75 w-1.75">
              <span
                className="absolute inset-0 rounded-full-3 bg-forest-ink"
                style={{ animation: 'livePulseRing 2s ease-out infinite' }}
              />
              <span className="relative h-1.75 w-1.75 rounded-full-3 bg-forest-ink" />
            </span>
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-forest-ink">
              Live
            </span>
          </span>
        )}
      </div>

      {/* The count — split-flap, Departure Mono, one loud number */}
      <div className="mt-10 flex items-baseline gap-3">
        <span
          className="font-mono text-[56px] font-bold leading-none tracking-[-0.02em] text-ink-black tabular-nums"
          aria-label={loading ? 'Memuatkan' : `${total} kenderaan dijejak secara langsung`}
        >
          {display.split('').map((ch, i) => (
            <FlapDigit key={i} value={ch} delay={i * 40} />
          ))}
        </span>
        <span className="max-w-[120px] font-sans text-[13px] font-semibold leading-tight text-sage-mute">
          kenderaan dijejak secara langsung
        </span>
      </div>

      {/* Per-network breakdown */}
      <div className="mt-14 flex flex-wrap gap-8">
        {(data?.networks ?? []).map(n => (
          <span
            key={n.network}
            className="flex items-center gap-1.5 rounded-full-2 border-2 border-ink-black bg-white-plate px-10 py-2 font-mono text-[11px] font-bold text-ink-black"
          >
            {SHORT_LABEL[n.network] ?? n.network}
            <span className="tabular-nums">{n.count}</span>
            {n.stale && (
              <span
                className="h-2 w-2 rounded-full-3 border border-ink-black bg-mustard-pop"
                aria-label="Data mungkin lewat"
              />
            )}
          </span>
        ))}
      </div>

      {/* Honesty line — the trust engine, on every screen */}
      <p className="mt-3 font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-sage-mute/80">
        Sumber: data.gov.my · LRT/MRT tiada suapan langsung
      </p>
    </div>
  )
}
