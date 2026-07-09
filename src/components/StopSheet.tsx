'use client'

import { useState } from 'react'
import { Drawer } from 'vaul'
import { getRailLine } from '@/lib/transit'

function StopNameText({ name }: { name: string }) {
  const match = name.match(/^(.+?)\s*(?:ke\s+arah|→|->)\s*(.+)$/i)
  if (!match) return <>{name}</>
  return (
    <>
      {match[1]}
      <span className="mx-1.5 font-normal text-sage-mute/60">→</span>
      {match[2]}
    </>
  )
}
import { useRouter } from 'next/navigation'
import { useLang } from '@/lib/i18n'
import { useUpcomingArrivals } from '@/hooks/useUpcomingArrivals'
import { useRealtimeVehicles } from '@/hooks/useRealtimeVehicles'
import { useLastTrain } from '@/hooks/useLastTrain'
import { ArrivalCard } from './ArrivalCard'
import type { Arrival, NearbyStop } from '@/lib/types'

const NETWORK_LABEL: Record<string, string> = {
  'rapid-bus-kl':  'RapidKL Bus',
  'rapid-rail-kl': 'Rapid Rail',
  'ktmb':          'KTM',
}

function SkeletonRow() {
  return <div className="h-27.5 rounded-2xl border-2 border-ink-black/15 bg-concrete-tile/20 animate-pulse" />
}

// ── Bookmark icon ─────────────────────────────────────────────────────────────

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden
      className="h-16 w-16"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M5 3h14a1 1 0 0 1 1 1v17l-8-4-8 4V4a1 1 0 0 1 1-1z"
      />
    </svg>
  )
}

// ── Ticket icon (receipt share) ───────────────────────────────────────────────

function TicketIcon() {
  return (
    <svg
      aria-hidden
      className="h-16 w-16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V8zM13 6v2m0 3v2m0 3v2"
      />
    </svg>
  )
}

// ── Last Train Guardian footer ────────────────────────────────────────────────

function LastTrainFooter({ stop }: { stop: NearbyStop }) {
  const { lastDepartures } = useLastTrain(stop.stop_id, stop.network)
  if (lastDepartures.length === 0) return null

  // One row per destination, latest first — the "settle the mamak bill" number.
  const seen = new Set<string>()
  const rows = lastDepartures.filter(d => {
    const key = `${d.route_id}:${d.trip_headsign ?? d.direction_id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 3)

  return (
    <div className="mt-14 rounded-2xl border-2 border-ink-black bg-midnight-ink p-14">
      <p className="flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-white-plate/70">
        <svg aria-hidden className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
        Perkhidmatan terakhir malam ini
      </p>
      <ul className="mt-10 space-y-8">
        {rows.map(d => (
          <li key={`${d.route_id}:${d.trip_headsign}:${d.direction_id}`} className="flex items-center justify-between gap-10">
            <span className="flex min-w-0 items-center gap-8">
              <span
                className="shrink-0 rounded-lg border-2 border-ink-black px-1.5 py-0.5 font-mono text-[11px] font-bold leading-none"
                style={{
                  backgroundColor: d.route_color ? `#${d.route_color}` : 'var(--color-white-plate)',
                  color:           d.route_text_color ? `#${d.route_text_color}` : 'var(--color-ink-black)',
                }}
              >
                {d.route_short_name ?? '—'}
              </span>
              <span className="truncate font-sans text-caption font-medium text-white-plate/80">
                {d.trip_headsign ?? 'Perkhidmatan'}
              </span>
            </span>
            <span className="shrink-0 font-mono text-body-sm font-bold text-lime-spark tabular-nums">
              {d.last_time}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Sheet body (only mounts when a stop is actually selected) ─────────────────

interface SheetBodyProps {
  stop:     NearbyStop
  isSaved:  boolean
  onSave:   () => void
  onRemove: () => void
}

function SheetBody({ stop, isSaved, onSave, onRemove }: SheetBodyProps) {
  const { t } = useLang()
  const router = useRouter()
  const { arrivals, isLoading } = useUpcomingArrivals(stop.stop_id, stop.network)
  const live = useRealtimeVehicles()

  // Delay Receipt — snapshot the departure board into a shareable ticket.
  function openReceipt(next: Arrival | null) {
    const lineInfo = stop.network === 'rapid-rail-kl' ? getRailLine(stop.stop_id) : null
    const q = new URLSearchParams({ stop: stop.stop_name.slice(0, 48) })
    if (lineInfo) {
      q.set('line', `${lineInfo.type} · ${lineInfo.name}`)
      q.set('color', lineInfo.color.replace('#', ''))
    } else if (next?.route_short_name) {
      q.set('line', next.route_short_name)
      if (next.route_color) q.set('color', next.route_color)
    }
    if (next) {
      q.set('mins', String(Math.max(0, next.minutes_until)))
      q.set('time', next.scheduled_time)
    }
    router.push(`/receipt?${q.toString()}`)
  }

  const isLive = stop.network === 'rapid-bus-kl' ? live.hasLiveBus
               : stop.network === 'ktmb'          ? live.hasLiveKtmb
               : false
  const stale  = stop.network === 'rapid-bus-kl' ? live.busStale
               : stop.network === 'ktmb'          ? live.ktmbStale
               : false

  const distLabel = stop.distance_m == null
    ? null
    : stop.distance_m < 1000
      ? `${Math.round(stop.distance_m)} m dari anda`
      : `${(stop.distance_m / 1000).toFixed(1)} km dari anda`

  const line = stop.network === 'rapid-rail-kl' ? getRailLine(stop.stop_id) : null

  return (
    <div className="mx-auto flex w-full max-w-md flex-col overflow-hidden">
      {/* Drag handle */}
      <Drawer.Handle className="mx-auto mb-0 mt-14 h-4 w-40 shrink-0 rounded-full-3 bg-ink-black/20" />

      {/* Header */}
      <div className="shrink-0 border-b-2 border-ink-black px-20 pb-18 pt-14">
        <div className="flex items-start justify-between gap-14">
          <div className="min-w-0">
            <Drawer.Title className="font-sans text-[19px] font-extrabold leading-snug tracking-[-0.02em] text-ink-black">
              <StopNameText name={stop.stop_name} />
            </Drawer.Title>
            <Drawer.Description className="mt-4 font-mono text-caption tabular-nums text-sage-mute">
              {distLabel ?? (NETWORK_LABEL[stop.network] ?? stop.network)}
            </Drawer.Description>
          </div>

          <div className="mt-2 flex shrink-0 items-center gap-8">
            {/* Delay Receipt — turn this departure board into a shareable ticket */}
            <button
              type="button"
              aria-label={t('sheet.share')}
              onClick={() => openReceipt(arrivals[0] ?? null)}
              className="flex h-9 w-9 items-center justify-center rounded-full-3 border-2 border-ink-black bg-white-plate text-ink-black active:scale-[0.97]"
              style={{ transition: 'transform 160ms var(--ease-out)' }}
            >
              <TicketIcon />
            </button>

            {/* Badge — colour swatch + "LRT · Kelana Jaya" on a white pill so
                the label stays legible on every line colour */}
            <span className="flex items-center gap-1.5 rounded-full-2 border-2 border-ink-black bg-white-plate px-8 py-2 font-mono text-[10px] font-bold text-ink-black">
              {line && (
                <span
                  className="h-8 w-8 rounded-full-3 border border-ink-black"
                  style={{ backgroundColor: line.color }}
                />
              )}
              {line ? `${line.type} · ${line.name}` : (NETWORK_LABEL[stop.network] ?? stop.network)}
            </span>

            {/* Save / unsave — fills lime when saved */}
            <button
              type="button"
              aria-label={isSaved ? t('sheet.removeAria') : t('sheet.saveAria')}
              onClick={isSaved ? onRemove : onSave}
              className="flex h-9 w-9 items-center justify-center rounded-full-3 border-2 border-ink-black text-ink-black active:scale-[0.97]"
              style={{
                backgroundColor: isSaved ? 'var(--color-lime-spark)' : 'var(--color-white-plate)',
                transition: 'transform 160ms var(--ease-out), background-color 150ms var(--ease-out)',
              }}
            >
              <BookmarkIcon filled={isSaved} />
            </button>
          </div>
        </div>
      </div>

      {/* Arrivals list */}
      <div
        className="space-y-10 overflow-y-auto px-20 py-18"
        style={{ paddingBottom: 'max(18px, env(safe-area-inset-bottom))' }}
      >
        {isLoading ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : arrivals.length === 0 ? (
          <p className="py-48 text-center font-sans text-body-sm text-sage-mute">
            {t('sheet.noArrivals')}
          </p>
        ) : (
          arrivals.map((a, i) => (
            <ArrivalCard
              key={`${a.trip_id}:${a.arr_secs}`}
              routeShortName={a.route_short_name ?? stop.network.toUpperCase()}
              headsign={a.trip_headsign ?? '—'}
              minutesUntil={a.minutes_until}
              network={stop.network}
              isLive={isLive}
              stale={stale}
              routeColor={a.route_color ?? undefined}
              routeTextColor={a.route_text_color ?? undefined}
              index={i}
            />
          ))
        )}

        {/* Last Train Guardian — settle the mamak bill in time */}
        {!isLoading && <LastTrainFooter stop={stop} />}
      </div>
    </div>
  )
}

// ── Public ────────────────────────────────────────────────────────────────────

interface StopSheetProps {
  stop:     NearbyStop | null
  onClose:  () => void
  isSaved:  boolean
  onSave:   (stop: NearbyStop) => void
  onRemove: (stop: NearbyStop) => void
}

export function StopSheet({ stop, onClose, isSaved, onSave, onRemove }: StopSheetProps) {
  // Retain the last non-null stop so SheetBody stays mounted during vaul's close
  // animation — prevents a flash of empty content while the drawer slides down.
  const [lastStop, setLastStop] = useState(stop)
  if (stop !== null && stop !== lastStop) setLastStop(stop)

  return (
    <Drawer.Root
      open={stop !== null}
      onOpenChange={open => { if (!open) onClose() }}
      noBodyStyles
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-ink-black/40" />
        <Drawer.Content className="fixed inset-x-0 bottom-0 max-h-[85dvh] rounded-t-3xl-2 border-t-2 border-ink-black bg-linen-canvas outline-none">
          {lastStop && (
            <SheetBody
              stop={lastStop}
              isSaved={isSaved}
              onSave={() => onSave(lastStop)}
              onRemove={() => onRemove(lastStop)}
            />
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
