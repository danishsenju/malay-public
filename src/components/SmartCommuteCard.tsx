'use client'

import { SectionLabel } from './SectionLabel'
import { FlapCountdown } from './FlapCountdown'
import { useLang } from '@/lib/i18n'
import { useUpcomingArrivals } from '@/hooks/useUpcomingArrivals'
import { getRailLine } from '@/lib/transit'
import type { NearbyStop } from '@/lib/types'

interface SmartCommuteCardProps {
  stop:     NearbyStop
  onSelect: (stop: NearbyStop) => void
}

/**
 * The zero-tap answer. When the on-device pattern says "this is their usual
 * stop at this hour", the next departure is already on screen before they
 * search. The best interaction is the one removed.
 */
export function SmartCommuteCard({ stop, onSelect }: SmartCommuteCardProps) {
  const { t } = useLang()
  const { arrivals, isLoading } = useUpcomingArrivals(stop.stop_id, stop.network)
  const next = arrivals[0] ?? null
  const line = stop.network === 'rapid-rail-kl' ? getRailLine(stop.stop_id) : null

  return (
    <section>
      <SectionLabel trailing={t('home.routine.learned')}>
        {t('home.routine')}
      </SectionLabel>

      <div className="mt-14" style={{ animation: 'cardEnter 250ms var(--ease-out) both' }}>
        <button
          type="button"
          onClick={() => onSelect(stop)}
          aria-label={`${t('home.routine')}: ${stop.stop_name}`}
          className="
            plate pressable w-full rounded-2xl bg-leaf-wash p-16 text-left
            flex items-center justify-between gap-14 text-ink-black
            focus:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-band focus-visible:ring-offset-2 focus-visible:ring-offset-linen-canvas
          "
        >
          <span className="min-w-0">
            <span className="flex items-center gap-8">
              {line && (
                <span
                  className="h-10 w-10 shrink-0 rounded-full-3 border-2 border-ink-black"
                  style={{ backgroundColor: line.color }}
                />
              )}
              <span className="truncate font-sans text-[15px] font-extrabold leading-snug tracking-[-0.01em]">
                {stop.stop_name}
              </span>
            </span>
            <span className="mt-4 block font-mono text-[11px] font-medium text-sage-mute">
              {next
                ? `${t('home.routine.next')} ${next.scheduled_time}${next.trip_headsign ? ` · ${next.trip_headsign}` : ''}`
                : isLoading ? t('home.routine.checking') : t('home.routine.noService')}
            </span>
          </span>

          <span className="shrink-0">
            {next ? (
              <FlapCountdown
                minutes={next.minutes_until}
                className="text-[28px] leading-none tracking-[-0.02em] text-ink-black"
              />
            ) : (
              <svg aria-hidden className="h-16 w-16 text-ink-black/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
              </svg>
            )}
          </span>
        </button>
      </div>
    </section>
  )
}
