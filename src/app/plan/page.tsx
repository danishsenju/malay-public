'use client'

import { useCallback, useState } from 'react'
import useSWR from 'swr'
import { SearchOverlay } from '@/components/SearchOverlay'
import { JourneyDetailSheet } from '@/components/JourneyDetailSheet'
import { getRailLine } from '@/lib/transit'
import { formatDuration } from '@/lib/liveTime'
import { getSupabase } from '@/lib/supabase'
import { PageHeader } from '@/components/PageHeader'
import { useLang } from '@/lib/i18n'
import type { AccessiblePlace } from '@/app/api/places/route'
import type { PlaceCategory } from '@/data/places'
import type {
  JourneyLeg, JourneyOption, JourneyResponse, JourneyTransfer, NearbyStop,
} from '@/lib/types'

/**
 * Rancang - journey planner over the WHOLE network. Direct rides, cross-line
 * transfers (MRT ↔ LRT ↔ Monorail) and cross-network hops (rail ↔ KTM) all
 * come from /api/journey; this page renders them as one honest timeline.
 */

type PickerTarget = 'from' | 'to' | null

// ── Stop picker row ──────────────────────────────────────────────────────────

function StopPickerRow({
  label, stop, placeName, placeholder, onClick,
}: {
  label: string
  stop: NearbyStop | null
  placeName?: string | null
  placeholder: string
  onClick: () => void
}) {
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
        <span className="min-w-0">
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
          {placeName && (
            <span className="mt-1 block truncate font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-sage-mute">
              → {placeName}
            </span>
          )}
        </span>
      ) : (
        <span className="font-sans text-[15px] font-medium text-sage-mute/70">
          {placeholder}
        </span>
      )}
    </button>
  )
}

// ── Journey option card ──────────────────────────────────────────────────────

function LegChip({ leg }: { leg: JourneyLeg }) {
  return (
    <span
      className="shrink-0 rounded-lg border-2 border-ink-black px-8 py-1 font-mono text-[12px] font-bold leading-none"
      style={{
        backgroundColor: leg.routeColor ? `#${leg.routeColor}` : 'var(--color-cobalt-band)',
        color:           leg.routeTextColor ? `#${leg.routeTextColor}` : '#ffffff',
      }}
    >
      {leg.routeShortName ?? '-'}
    </span>
  )
}

function WalkRow({ transfer, label, sameStationLabel, walkLabel }: {
  transfer: JourneyTransfer
  label: string
  sameStationLabel: string
  walkLabel: string
}) {
  return (
    <div className="flex items-center gap-8 py-2 pl-2">
      <svg aria-hidden className="h-3 w-3 shrink-0 text-sage-mute" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 4a2 2 0 1 0 0-.01M10 20l2-5m0 0 1-4m-1 4 3 2m-3-6 .6-2.4a2 2 0 0 1 2.3-1.5L17 8m-7 3-2.5 1L6 15" />
      </svg>
      <p className="min-w-0 flex-1 truncate font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-sage-mute">
        {label} {transfer.toName}
        <span className="ml-6 normal-case tracking-normal text-sage-mute/80">
          · {transfer.sameStation ? sameStationLabel : `${transfer.walkMin} min ${walkLabel}`}
        </span>
      </p>
    </div>
  )
}

function OptionCard({
  option, index, fallbackFrom, fallbackTo, onOpen,
}: {
  option: JourneyOption
  index: number
  fallbackFrom: string
  fallbackTo: string
  onOpen: (option: JourneyOption) => void
}) {
  const { t, lang } = useLang()
  const nTransfers = option.legs.length - 1
  const transfersLabel =
    nTransfers === 0 ? t('plan.transfers.0')
    : nTransfers === 1 ? t('plan.transfers.1')
    : `${nTransfers} ${t('plan.transfers.n')}`

  return (
    <li style={{ animation: `cardEnter 250ms var(--ease-out) ${index * 60}ms both` }}>
      <button
        type="button"
        onClick={() => onOpen(option)}
        className="
          plate pressable shadow-plate w-full rounded-2xl p-16 text-left
          [@media(hover:hover)_and_(pointer:fine)]:hover:bg-leaf-wash/60
          focus:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-band focus-visible:ring-offset-2 focus-visible:ring-offset-linen-canvas
        "
      >
        {/* Times + duration */}
        <div className="flex items-center justify-between gap-14">
          <span className="font-mono text-[26px] font-bold leading-none tracking-[-0.02em] text-ink-black tabular-nums">
            {option.depTime}
            <span className="mx-8 text-sage-mute/50">→</span>
            {option.arrTime}
          </span>
          <span className="shrink-0 rounded-full-2 border-2 border-ink-black bg-lime-spark px-10 py-2 font-mono text-[11px] font-bold text-ink-black tabular-nums">
            {formatDuration(option.totalMin, lang)}
          </span>
        </div>

        <p className="mt-2 flex items-center justify-between gap-10 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-sage-mute">
          {transfersLabel}
          <span className="flex shrink-0 items-center gap-4 normal-case tracking-normal text-sage-mute/80">
            {t('plan.details')}
            <svg aria-hidden className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </span>
        </p>

        {/* Legs joined by walk rows */}
        <div className="mt-10 space-y-4">
          {option.startWalk && (
            <WalkRow
              transfer={option.startWalk}
              label={t('plan.walkStart')}
              sameStationLabel={t('plan.sameStation')}
              walkLabel={t('plan.walkTransfer')}
            />
          )}
          {option.legs.map((leg, i) => (
            <div key={i}>
              <div className="flex items-center gap-8">
                <LegChip leg={leg} />
                <span className="min-w-0 flex-1 truncate font-sans text-caption font-medium text-midnight-ink/80">
                  {(leg.fromName || fallbackFrom)}
                  <span className="mx-4 text-sage-mute/60">→</span>
                  {(leg.toName || fallbackTo)}
                </span>
                <span className="shrink-0 font-mono text-[11px] font-medium text-sage-mute tabular-nums">
                  {leg.depTime}–{leg.arrTime}
                </span>
              </div>
              {i < option.legs.length - 1 && option.transfers[i] && (
                <WalkRow
                  transfer={option.transfers[i]}
                  label={t('plan.transferAt')}
                  sameStationLabel={t('plan.sameStation')}
                  walkLabel={t('plan.walkTransfer')}
                />
              )}
            </div>
          ))}
          {option.endWalk && (
            <WalkRow
              transfer={option.endWalk}
              label={t('plan.walkStart')}
              sameStationLabel={t('plan.sameStation')}
              walkLabel={t('plan.walkTransfer')}
            />
          )}
        </div>
      </button>
    </li>
  )
}

// ── Places (malls / hospitals / attractions by transit) ─────────────────────

const CATEGORY_META: { id: PlaceCategory; fill: string }[] = [
  { id: 'mall',       fill: 'var(--color-lavender-mist)' },
  { id: 'hospital',   fill: 'var(--color-leaf-wash)' },
  { id: 'attraction', fill: 'var(--color-mustard-pop)' },
]

const jsonFetcher = (url: string) => fetch(url).then(r => {
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
})

function PlacesSection({ onPick }: { onPick: (place: AccessiblePlace) => void }) {
  const { t } = useLang()
  const [category, setCategory] = useState<PlaceCategory>('mall')
  const { data, error } = useSWR<{ places: AccessiblePlace[] }>('/api/places', jsonFetcher, {
    revalidateOnFocus: false,
  })

  const catLabel: Record<PlaceCategory, string> = {
    mall: t('places.mall'),
    hospital: t('places.hospital'),
    attraction: t('places.attraction'),
  }

  const places = (data?.places ?? []).filter(p => p.category === category)

  return (
    <section className="mt-48">
      <div className="flex items-baseline justify-between gap-14">
        <h2 className="font-sans text-[22px] font-extrabold leading-tight tracking-[-0.02em] text-ink-black">
          {t('places.title')}
        </h2>
      </div>
      <p className="mt-4 font-sans text-[13px] leading-relaxed text-sage-mute">
        {t('places.desc')}
      </p>

      {/* Category chips */}
      <div className="mt-14 flex gap-8">
        {CATEGORY_META.map(c => {
          const active = category === c.id
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className="shrink-0 rounded-full-2 border-2 border-ink-black px-14 py-4 font-mono text-caption font-bold active:scale-[0.95]"
              style={{
                backgroundColor: active ? c.fill : 'var(--color-white-plate)',
                color: active ? 'var(--color-ink-black)' : 'var(--color-sage-mute)',
                transition: 'background-color 150ms var(--ease-out), color 150ms var(--ease-out), transform 140ms var(--ease-out)',
              }}
            >
              {catLabel[c.id]}
            </button>
          )
        })}
      </div>

      {/* Place cards */}
      <div className="mt-16">
        {error && (
          <p className="font-sans text-body-sm text-sage-mute">{t('places.failed')}</p>
        )}
        {!data && !error && (
          <div className="space-y-10">
            <div className="h-19 animate-pulse rounded-2xl border-2 border-ink-black/15 bg-concrete-tile/20" />
            <div className="h-19 animate-pulse rounded-2xl border-2 border-ink-black/15 bg-concrete-tile/20" />
            <div className="h-19 animate-pulse rounded-2xl border-2 border-ink-black/15 bg-concrete-tile/20" />
          </div>
        )}
        {data && (
          <ul className="space-y-10">
            {places.map((p, i) => {
              const line = p.access.network === 'rapid-rail-kl' ? getRailLine(p.access.stop_id) : null
              const dist = p.access.distance_m == null ? null : Math.round(p.access.distance_m)
              return (
                <li key={p.id} style={{ animation: `cardEnter 200ms var(--ease-out) ${Math.min(i, 8) * 30}ms both` }}>
                  <button
                    type="button"
                    onClick={() => onPick(p)}
                    className="plate pressable-sm flex w-full items-center gap-14 rounded-2xl px-16 py-12 text-left [@media(hover:hover)_and_(pointer:fine)]:hover:bg-leaf-wash/60"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-sans text-[15px] font-bold leading-snug text-ink-black">
                        {p.name}
                      </span>
                      <span className="mt-2 flex min-w-0 items-center gap-6 font-mono text-[11px] font-medium text-sage-mute">
                        {line && (
                          <span
                            className="h-8 w-8 shrink-0 rounded-full-3 border-2 border-ink-black"
                            style={{ backgroundColor: line.color }}
                          />
                        )}
                        <span className="truncate">
                          {dist != null && `${dist} m ${t('places.walkFrom')} `}
                          {p.access.stop_name}
                        </span>
                      </span>
                    </span>
                    <span className="shrink-0 rounded-full-2 border-2 border-ink-black bg-linen-canvas px-8 py-px font-mono text-[10px] font-bold text-ink-black">
                      {p.city}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function PlanPage() {
  const { t } = useLang()
  const [from, setFrom] = useState<NearbyStop | null>(null)
  const [to, setTo] = useState<NearbyStop | null>(null)
  const [toPlace, setToPlace] = useState<string | null>(null)
  const [picker, setPicker] = useState<PickerTarget>(null)
  const [result, setResult] = useState<JourneyResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [locating, setLocating] = useState(false)
  const [detailOption, setDetailOption] = useState<JourneyOption | null>(null)

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

  // Search is driven by the events that change the pair - no effect needed.
  function applyStops(nextFrom: NearbyStop | null, nextTo: NearbyStop | null) {
    setFrom(nextFrom)
    setTo(nextTo)
    if (nextFrom && nextTo) search(nextFrom, nextTo)
  }

  function swap() {
    setToPlace(null)
    applyStops(to, from)
  }

  function pickPlace(place: AccessiblePlace) {
    setToPlace(place.name)
    applyStops(from, place.access)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function useMyLocation() {
    if (!navigator?.geolocation || locating) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async pos => {
        try {
          // Wide ring - even a user far from any stop gets their nearest
          // boarding point instead of a silent no-op.
          const { data } = await getSupabase().rpc('nearby_stops', {
            p_lat: pos.coords.latitude,
            p_lon: pos.coords.longitude,
            p_radius_m: 20_000,
            p_limit: 4,
          })
          const stops = (data ?? []) as NearbyStop[]
          const best = stops.find(s => s.network !== 'rapid-bus-kl') ?? stops[0]
          if (best) applyStops(best, to)
        } finally {
          setLocating(false)
        }
      },
      () => setLocating(false),
      { timeout: 8_000, maximumAge: 60_000 },
    )
  }

  const ready = from !== null && to !== null

  return (
    <div className="min-h-screen bg-linen-canvas">
      <PageHeader />
      <div className="mx-auto max-w-md px-20 pb-128 lg:max-w-2xl lg:pb-64">

        {/* ── Hero ── */}
        <div className="pt-26" style={{ animation: 'riseIn 340ms var(--ease-out) both' }}>
          <h1 className="font-sans text-[40px] font-extrabold leading-[1.02] tracking-[-0.03em] text-ink-black">
            {t('plan.title.1')}
            <br />
            <span className="relative inline-block">
              <span
                aria-hidden
                className="-inset-x-1.5 absolute bottom-0.75 h-[0.42em] origin-left rounded-lg bg-lime-spark"
                style={{ animation: 'highlightIn 380ms var(--ease-out) 300ms both' }}
              />
              <span className="relative">{t('plan.title.2')}</span>
            </span>
          </h1>
        </div>

        {/* ── From / To picker ── */}
        <div className="mt-24" style={{ animation: 'riseIn 340ms var(--ease-out) 80ms both' }}>
          <div className="plate shadow-plate relative rounded-3xl-2">
            <StopPickerRow
              label={t('plan.from')}
              stop={from}
              placeholder={t('plan.pickStop')}
              onClick={() => setPicker('from')}
            />
            <div className="mx-16 border-t-2 border-dashed border-ink-black/15" />
            <StopPickerRow
              label={t('plan.to')}
              stop={to}
              placeName={toPlace}
              placeholder={t('plan.pickStop')}
              onClick={() => setPicker('to')}
            />

            {/* Swap - pinned to the seam between the two rows */}
            <button
              type="button"
              aria-label={t('plan.swap')}
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

          {/* Use my location */}
          {!from && (
            <button
              type="button"
              onClick={useMyLocation}
              disabled={locating}
              className="
                mt-10 flex items-center gap-6 rounded-full-2 border-2 border-ink-black bg-white-plate
                px-14 py-4 font-mono text-caption font-bold text-ink-black active:scale-[0.96]
                disabled:opacity-50
              "
              style={{ transition: 'transform 140ms var(--ease-out)' }}
            >
              <svg aria-hidden className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 21c-4.5-4-7-7.2-7-10.2A7 7 0 0 1 12 4a7 7 0 0 1 7 6.8c0 3-2.5 6.2-7 10.2Z" />
                <circle cx="12" cy="10.8" r="2.5" />
              </svg>
              {locating ? t('plan.locating') : t('plan.useLocation')}
            </button>
          )}
        </div>

        {/* ── Results ── */}
        <div className="mt-26">
          {!ready && !loading && (
            <p className="px-8 text-center font-sans text-body-sm leading-relaxed text-sage-mute">
              {t('plan.intro')}
            </p>
          )}

          {loading && (
            <div className="space-y-10" aria-label={t('plan.loading')}>
              <div className="h-27.5 animate-pulse rounded-2xl border-2 border-ink-black/15 bg-concrete-tile/20" />
              <div className="h-27.5 animate-pulse rounded-2xl border-2 border-ink-black/15 bg-concrete-tile/20" />
            </div>
          )}

          {failed && (
            <p className="text-center font-sans text-body-sm text-sage-mute">
              {t('plan.failed')}
            </p>
          )}

          {result && !result.supported && (
            <div className="rounded-2xl border-2 border-ink-black bg-mustard-pop p-18">
              <p className="font-sans text-body-sm font-bold leading-relaxed text-ink-black">
                {t('plan.busCross')}
              </p>
            </div>
          )}

          {result && result.supported && result.options.length === 0 && (
            <p className="text-center font-sans text-body-sm leading-relaxed text-sage-mute">
              {t('plan.none')}
            </p>
          )}

          {result && result.options.length > 0 && (
            <>
              <ol className="space-y-10">
                {result.options.map((o, i) => (
                  <OptionCard
                    key={i}
                    option={o}
                    index={i}
                    fallbackFrom={from?.stop_name ?? ''}
                    fallbackTo={to?.stop_name ?? ''}
                    onOpen={setDetailOption}
                  />
                ))}
              </ol>
              <p className="mt-16 text-center font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-sage-mute/80">
                {t('plan.footnote')}
              </p>
            </>
          )}
        </div>

        {/* ── Places you can reach by transit ── */}
        <PlacesSection onPick={pickPlace} />
      </div>

      {/* ── Journey detail sheet - tap a card to see the full breakdown ── */}
      <JourneyDetailSheet option={detailOption} onClose={() => setDetailOption(null)} />

      {/* ── Stop picker overlay (shared search UI) ── */}
      <SearchOverlay
        isOpen={picker !== null}
        onClose={() => setPicker(null)}
        onSelect={stop => {
          if (picker === 'from') applyStops(stop, to)
          if (picker === 'to') { setToPlace(null); applyStops(from, stop) }
          setPicker(null)
        }}
      />
    </div>
  )
}
