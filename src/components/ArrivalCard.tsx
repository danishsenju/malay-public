'use client'

import { FlapCountdown } from './FlapCountdown'
import { DirectionalText } from './DirectionalText'
import { useLang } from '@/lib/i18n'
import { splitDirectional } from '@/lib/transit'
import type { Network } from '@/lib/types'

export type { Network }

export interface ArrivalCardProps {
  routeShortName: string   // "U6201", "KJL", "KTM"
  headsign: string         // "Pasar Seni → KLCC"
  minutesUntil: number     // drives FlapCountdown
  network: Network
  isLive: boolean          // true = show pulsing live chip
  stale?: boolean          // true = mustard "stale" dot instead of live pulse
  routeColor?: string      // hex without # from GTFS (e.g. "009EE0"); null → cobalt
  routeTextColor?: string  // hex without # from GTFS; null → white
  dark?: boolean           // kept for call-site compatibility — plates are always light now
  index?: number           // position in list — drives 50ms per-card entrance stagger
  onClick?: () => void
}

const NETWORK_KEY = {
  'rapid-bus-kl':  'network.bus',
  'rapid-rail-kl': 'network.rail',
  'ktmb':          'network.ktmb',
} as const

export function ArrivalCard({
  routeShortName,
  headsign,
  minutesUntil,
  network,
  isLive,
  stale = false,
  routeColor,
  routeTextColor,
  index = 0,
  onClick,
}: ArrivalCardProps) {
  const { t } = useLang()
  const chipBg   = routeColor     ? `#${routeColor}`     : 'var(--color-cobalt-band)'
  const chipText = routeTextColor ? `#${routeTextColor}` : '#ffffff'

  const arrivalLabel  = minutesUntil <= 0 ? t('card.arrivingNow') : `${minutesUntil} ${t('common.min')}`
  // Screen readers hear "KJL towards Gombak, 5 min" — destination only, so a
  // directional headsign never stacks two "towards" in one sentence.
  const parts         = splitDirectional(headsign)
  const buttonLabel   = `${routeShortName} ${t('card.towards')} ${parts ? parts[1] : headsign}, ${arrivalLabel}`

  // Wrapper owns the entrance animation; the button owns the press. Keeping
  // them separate avoids animation fill-mode overriding :active transforms.
  return (
    <div style={{ animation: `cardEnter 250ms var(--ease-out) ${index * 50}ms both` }}>
      <button
        type="button"
        onClick={onClick}
        aria-label={buttonLabel}
        className="
          plate pressable w-full rounded-2xl p-16 text-left
          flex flex-col gap-14 text-ink-black
          [@media(hover:hover)_and_(pointer:fine)]:hover:bg-leaf-wash/60
          focus:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-band focus-visible:ring-offset-2 focus-visible:ring-offset-linen-canvas
        "
      >
        {/* ── Row 1: route chip + network + live chip ── */}
        <div className="flex items-center justify-between gap-8">
          <div className="flex min-w-0 items-center gap-8">
            {/* Route chip — Departure Mono on the GTFS route colour, ink stroke */}
            <span
              className="shrink-0 rounded-lg border-2 border-ink-black px-8 py-1 font-mono text-[13px] font-bold leading-none tracking-[0.02em]"
              style={{ backgroundColor: chipBg, color: chipText }}
            >
              {routeShortName}
            </span>
            <span className="truncate font-sans text-caption font-semibold text-sage-mute">
              {t(NETWORK_KEY[network])}
            </span>
          </div>

          {/* Live indicator — only when the network has a realtime feed */}
          {isLive && !stale ? (
            <span
              className="flex shrink-0 items-center gap-1.5 rounded-full-2 border-2 border-ink-black bg-leaf-wash px-8 py-0.5"
              aria-label={t('card.liveAria')}
            >
              <span className="relative flex h-1.5 w-1.5">
                <span
                  className="absolute inset-0 rounded-full-3 bg-forest-ink"
                  style={{ animation: 'livePulseRing 2s ease-out infinite' }}
                />
                <span className="relative h-1.5 w-1.5 rounded-full-3 bg-forest-ink" />
              </span>
              <span className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-forest-ink">
                Live
              </span>
            </span>
          ) : isLive && stale ? (
            <span
              className="h-2 w-2 shrink-0 rounded-full-3 border border-ink-black bg-mustard-pop"
              aria-label={t('card.staleAria')}
            />
          ) : null}
        </div>

        {/* ── Row 2: headsign ── */}
        <p className="font-sans text-body-sm leading-snug text-midnight-ink/80">
          <DirectionalText text={headsign} />
        </p>

        {/* ── Row 3: the split-flap countdown, below a perforated ticket edge ── */}
        <div className="flex justify-center border-t-2 border-dashed border-ink-black/15 pt-10">
          <FlapCountdown minutes={minutesUntil} className="text-[42px] leading-none tracking-[-0.02em] text-ink-black" />
        </div>
      </button>
    </div>
  )
}
