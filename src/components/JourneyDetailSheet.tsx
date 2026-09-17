'use client'

import { useState } from 'react'
import { Drawer } from 'vaul'
import { useLang } from '@/lib/i18n'
import { formatDuration } from '@/lib/liveTime'
import { headsignDestination } from '@/lib/transit'
import type { JourneyLeg, JourneyOption, JourneyTransfer } from '@/lib/types'

/**
 * Full journey breakdown for one Rancang option - opened by tapping an
 * OptionCard. Same vaul drawer pattern as StopSheet: keeps the last non-null
 * option mounted so the close animation never shows an empty sheet.
 */

function WalkDetailRow({ transfer, label }: { transfer: JourneyTransfer; label: string }) {
  return (
    <div className="flex items-center gap-10 py-8 pl-14">
      <svg aria-hidden className="h-3.5 w-3.5 shrink-0 text-sage-mute" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 4a2 2 0 1 0 0-.01M10 20l2-5m0 0 1-4m-1 4 3 2m-3-6 .6-2.4a2 2 0 0 1 2.3-1.5L17 8m-7 3-2.5 1L6 15" />
      </svg>
      <p className="min-w-0 flex-1 font-mono text-[11px] font-bold uppercase tracking-widest text-sage-mute">
        {label} {transfer.toName}
      </p>
    </div>
  )
}

function LegDetail({ leg }: { leg: JourneyLeg }) {
  const { t, lang } = useLang()
  const railColor = leg.routeColor ? `#${leg.routeColor}` : 'var(--color-cobalt-band)'
  return (
    <div
      className="rounded-2xl border-2 border-ink-black bg-white-plate p-14"
      style={{ borderLeftWidth: 6, borderLeftColor: railColor }}
    >
      {/* Route chip + headsign */}
      <div className="flex items-center gap-8">
        <span
          className="shrink-0 rounded-lg border-2 border-ink-black px-8 py-1 font-mono text-[12px] font-bold leading-none"
          style={{
            backgroundColor: railColor,
            color: leg.routeTextColor ? `#${leg.routeTextColor}` : '#ffffff',
          }}
        >
          {leg.routeShortName ?? '-'}
        </span>
        {leg.headsign && (
          <span className="min-w-0 truncate font-sans text-caption font-semibold text-sage-mute">
            {/* "From Kajang to Kwasa Damansara" → "→ Kwasa Damansara": the arrow
                already says "towards", so only the destination is repeated. */}
            → {headsignDestination(leg.headsign)}
          </span>
        )}
      </div>

      {/* Board */}
      <div className="mt-10 flex items-baseline justify-between gap-10">
        <p className="min-w-0 font-sans text-body-sm font-bold leading-snug text-ink-black">
          <span className="mr-6 font-mono text-[10px] font-bold uppercase tracking-widest text-sage-mute">
            {t('plan.detail.board')}
          </span>
          {leg.fromName}
        </p>
        <span className="shrink-0 font-mono text-body-sm font-bold tabular-nums text-ink-black">{leg.depTime}</span>
      </div>

      {/* Ride meta */}
      <p className="mt-6 pl-2 font-mono text-[11px] font-medium text-sage-mute tabular-nums">
        {leg.numStops} {t('common.stops')} · {formatDuration(leg.durationMin, lang)}
      </p>

      {/* Prasarana doesn't publish live positions for any rail line - unlike
          KTM/bus legs, this time can never be corrected against a live feed. */}
      {leg.network === 'rapid-rail-kl' && (
        <p className="mt-4 pl-2 font-mono text-[10px] font-medium normal-case tracking-normal text-sage-mute/80">
          {t('plan.detail.railHonesty')}
        </p>
      )}

      {/* Alight */}
      <div className="mt-6 flex items-baseline justify-between gap-10">
        <p className="min-w-0 font-sans text-body-sm font-bold leading-snug text-ink-black">
          <span className="mr-6 font-mono text-[10px] font-bold uppercase tracking-widest text-sage-mute">
            {t('plan.detail.alight')}
          </span>
          {leg.toName}
        </p>
        <span className="shrink-0 font-mono text-body-sm font-bold tabular-nums text-ink-black">{leg.arrTime}</span>
      </div>
    </div>
  )
}

function SheetBody({ option }: { option: JourneyOption }) {
  const { t, lang } = useLang()
  const nTransfers = option.legs.length - 1
  const transfersLabel =
    nTransfers === 0 ? t('plan.transfers.0')
    : nTransfers === 1 ? t('plan.transfers.1')
    : `${nTransfers} ${t('plan.transfers.n')}`

  return (
    // min-h-0 lets this flex item shrink to the drawer's max-height so the
    // timeline below can actually scroll instead of being cut off.
    <div className="mx-auto flex min-h-0 w-full max-w-md flex-col overflow-hidden">
      <Drawer.Handle className="mx-auto mb-0 mt-14 h-4 w-40 shrink-0 rounded-full-3 bg-ink-black/20" />

      {/* Header */}
      <div className="shrink-0 border-b-2 border-ink-black px-20 pb-18 pt-14">
        <Drawer.Title className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-sage-mute">
          {t('plan.detail.title')}
        </Drawer.Title>
        <div className="mt-8 flex items-center justify-between gap-14">
          <span className="font-mono text-[30px] font-bold leading-none tracking-[-0.02em] text-ink-black tabular-nums">
            {option.depTime}
            <span className="mx-8 text-sage-mute/50">→</span>
            {option.arrTime}
          </span>
          <span className="shrink-0 rounded-full-2 border-2 border-ink-black bg-lime-spark px-10 py-2 font-mono text-[11px] font-bold text-ink-black tabular-nums">
            {formatDuration(option.totalMin, lang)}
          </span>
        </div>
        <Drawer.Description className="mt-4 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-sage-mute">
          {t('plan.detail.depart')} {option.depTime} · {t('plan.detail.arrive')} {option.arrTime} · {transfersLabel}
        </Drawer.Description>
      </div>

      {/* Timeline - touch-pan-y re-enables native touch scrolling: vaul sets
          touch-action:none on the drawer root to own the drag-to-close
          gesture, which otherwise blocks scrolling on this nested list too. */}
      <div
        className="min-h-0 touch-pan-y space-y-8 overflow-y-auto px-20 py-18"
        style={{ paddingBottom: 'max(18px, env(safe-area-inset-bottom))' }}
      >
        {option.startWalk && <WalkDetailRow transfer={option.startWalk} label={t('plan.walkStart')} />}

        {option.legs.map((leg, i) => (
          <div key={i}>
            <LegDetail leg={leg} />
            {i < option.legs.length - 1 && option.transfers[i] && (
              <WalkDetailRow transfer={option.transfers[i]} label={t('plan.transferAt')} />
            )}
          </div>
        ))}

        {option.endWalk && <WalkDetailRow transfer={option.endWalk} label={t('plan.walkEnd')} />}

        <p className="pt-10 text-center font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-sage-mute/80">
          {t('plan.footnote')}
        </p>
      </div>
    </div>
  )
}

interface JourneyDetailSheetProps {
  option:  JourneyOption | null
  onClose: () => void
}

export function JourneyDetailSheet({ option, onClose }: JourneyDetailSheetProps) {
  const [lastOption, setLastOption] = useState(option)
  if (option !== null && option !== lastOption) setLastOption(option)

  return (
    <Drawer.Root
      open={option !== null}
      onOpenChange={open => { if (!open) onClose() }}
      noBodyStyles
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-ink-black/40" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 flex max-h-[85dvh] flex-col rounded-t-3xl-2 border-t-2 border-ink-black bg-linen-canvas outline-none">
          {lastOption && <SheetBody option={lastOption} />}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
