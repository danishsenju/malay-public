'use client'

import { SectionLabel } from './SectionLabel'
import { getRailLine } from '@/lib/transit'
import type { NearbyStop } from '@/lib/types'

const NETWORK_LABEL: Record<string, string> = {
  'rapid-bus-kl':  'RapidKL',
  'rapid-rail-kl': 'Rapid Rail',
  'ktmb':          'KTM',
}

// Tile fills rotate through the pastel plates so a row of saved stops reads
// like a strip of stickers, never a grid of identical grey cards.
const TILE_FILLS = [
  'var(--color-lavender-mist)',
  'var(--color-leaf-wash)',
  'var(--color-mustard-pop)',
  'var(--color-moss-tint)',
]

interface SavedSectionProps {
  stops: NearbyStop[]
  onSelect: (stop: NearbyStop) => void
}

export function SavedSection({ stops, onSelect }: SavedSectionProps) {
  return (
    <section className="space-y-18">
      <SectionLabel trailing={stops.length > 0 ? String(stops.length) : undefined}>
        Disimpan
      </SectionLabel>

      {stops.length === 0 ? (
        <p className="font-sans text-body-sm leading-relaxed text-sage-mute">
          Simpan hentian yang kerap anda guna — ia muncul di sini dahulu.
        </p>
      ) : (
        <div className="mx-[-20px] flex gap-3 overflow-x-auto px-20 pb-8 pt-4 snap-x snap-mandatory scrollbar-none lg:mx-0 lg:px-0">
          {stops.map((stop, i) => {
            const line = stop.network === 'rapid-rail-kl' ? getRailLine(stop.stop_id) : null
            return (
              <button
                key={`${stop.stop_id}:${stop.network}`}
                type="button"
                onClick={() => onSelect(stop)}
                className="
                  pressable-sm min-w-42.5 max-w-42.5 shrink-0 snap-start text-left
                  rounded-2xl border-2 border-ink-black p-14
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-band focus-visible:ring-offset-2 focus-visible:ring-offset-linen-canvas
                "
                style={{
                  backgroundColor: TILE_FILLS[i % TILE_FILLS.length],
                  animation: `cardEnter 250ms var(--ease-out) ${i * 40}ms both`,
                }}
              >
                <p className="font-sans text-[13px] font-bold leading-snug text-ink-black line-clamp-2">
                  {stop.stop_name}
                </p>
                <span className="mt-3 inline-flex rounded-full-2 border-2 border-ink-black bg-white-plate px-8 py-px font-mono text-[10px] font-bold text-ink-black">
                  {line ? line.type : (NETWORK_LABEL[stop.network] ?? stop.network)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
