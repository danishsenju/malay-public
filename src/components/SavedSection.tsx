'use client'

import { SectionLabel } from './SectionLabel'
import { useLang } from '@/lib/i18n'
import { getRailLine } from '@/lib/transit'
import { useUpcomingArrivals } from '@/hooks/useUpcomingArrivals'
import { useNow } from '@/hooks/useNow'
import { liveMinutesUntil } from '@/lib/liveTime'
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

// ── Live next-departure line ─────────────────────────────────────────────────
// Each saved tile carries its own live countdown, pulled from the same
// upcoming_arrivals RPC as everywhere else — so "Disimpan" is a departure
// board at a glance, not a static bookmark.

function NextDeparture({ stop }: { stop: NearbyStop }) {
  const { t } = useLang()
  const { arrivals, isLoading } = useUpcomingArrivals(stop.stop_id, stop.network)
  const now = useNow()

  const next = arrivals
    .map(a => ({ ...a, minutes_until: liveMinutesUntil(a.arr_secs, now) }))
    .filter(a => a.minutes_until >= 0)[0]

  return (
    <span className="mt-6 block font-mono text-[10px] font-bold tabular-nums text-ink-black/70">
      {isLoading
        ? '…'
        : next
          ? `${t('home.routine.next')} · ${next.minutes_until <= 0 ? 'ARR' : `${next.minutes_until} min`}`
          : t('home.routine.noService')}
    </span>
  )
}

interface SavedSectionProps {
  stops: NearbyStop[]
  onSelect: (stop: NearbyStop) => void
}

export function SavedSection({ stops, onSelect }: SavedSectionProps) {
  const { t } = useLang()
  return (
    <section className="space-y-18">
      <SectionLabel trailing={stops.length > 0 ? String(stops.length) : undefined}>
        {t('home.saved')}
      </SectionLabel>

      {stops.length === 0 ? (
        <p className="font-sans text-body-sm leading-relaxed text-sage-mute">
          {t('home.saved.empty')}
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
                <NextDeparture stop={stop} />
              </button>
            )
          })}
        </div>
      )}
    </section>
  )
}
