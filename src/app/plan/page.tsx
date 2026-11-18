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
  JourneyLeg, JourneyOption, JourneyResponse, NearbyStop,
} from '@/lib/types'

/**
 * Rancang - journey planner over the WHOLE network. Direct rides, cross-line
 * transfers (MRT ↔ LRT ↔ Monorail) and cross-network hops (rail ↔ KTM) all
 * come from /api/journey; this page renders them as one honest timeline.
 *
 * Layout: a route "ticket" (origin → destination on one dashed spine), then
 * results as boarding-pass cards whose proportional strip shows where the
 * minutes actually go (ride vs walk), then places as one-tap destinations.
 */

type PickerTarget = 'from' | 'to' | null

const legColor = (leg: JourneyLeg) =>
  leg.routeColor ? `#${leg.routeColor}` : 'var(--color-cobalt-band)'

// ── Route ticket ─────────────────────────────────────────────────────────────

function TicketRow({
  label, stop, placeName, placeholder, onClick, marker,
}: {
  label: string
  stop: NearbyStop | null
  placeName?: string | null
  placeholder: string
  onClick: () => void
  marker: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="
        relative flex h-[68px] w-full items-center gap-14 pl-16 pr-[64px] text-left
        hover:bg-leaf-wash/60 active:bg-leaf-wash
        focus:outline-none focus-visible:bg-leaf-wash
      "
      style={{ transition: 'background-color 120ms var(--ease-out)' }}
    >
      <span className="relative z-10 flex w-[20px] shrink-0 justify-center">{marker}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-mono text-[10px] font-bold uppercase leading-none tracking-[0.16em] text-sage-mute">
          {label}
        </span>
        {stop ? (
          <>
            <span className="mt-4 block truncate font-sans text-[17px] font-extrabold leading-tight tracking-[-0.01em] text-ink-black">
              {stop.stop_name}
            </span>
            {placeName && (
              <span className="block truncate font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-sage-mute">
                → {placeName}
              </span>
            )}
          </>
        ) : (
          <span className="mt-4 block truncate font-sans text-[17px] font-semibold leading-tight text-sage-mute/60">
            {placeholder}
          </span>
        )}
      </span>
    </button>
  )
}

function OriginMarker({ stop }: { stop: NearbyStop | null }) {
  const line = stop?.network === 'rapid-rail-kl' ? getRailLine(stop.stop_id) : null
  return (
    <span
      className="block h-[16px] w-[16px] rounded-full border-2 border-ink-black"
      style={{ backgroundColor: line?.color ?? 'var(--color-white-plate)' }}
    />
  )
}

function DestinationMarker() {
  return (
    <span className="block h-[16px] w-[16px] rotate-45 rounded-[4px] border-2 border-ink-black bg-lime-spark" />
  )
}

// ── Journey option card ──────────────────────────────────────────────────────

type Segment =
  | { kind: 'ride'; min: number; color: string; label: string }
  | { kind: 'walk'; min: number }

/** Flatten an option into the strip: walk · ride · walk · ride · walk. */
function buildSegments(option: JourneyOption): Segment[] {
  const out: Segment[] = []
  if (option.startWalk && option.startWalk.walkMin > 0) {
    out.push({ kind: 'walk', min: option.startWalk.walkMin })
  }
  option.legs.forEach((leg, i) => {
    out.push({
      kind: 'ride',
      min: Math.max(leg.durationMin, 1),
      color: legColor(leg),
      label: leg.routeShortName ?? '-',
    })
    const tr = option.transfers[i]
    if (i < option.legs.length - 1 && tr && tr.walkMin > 0) {
      out.push({ kind: 'walk', min: tr.walkMin })
    }
  })
  if (option.endWalk && option.endWalk.walkMin > 0) {
    out.push({ kind: 'walk', min: option.endWalk.walkMin })
  }
  return out
}

function JourneyStrip({ option }: { option: JourneyOption }) {
  const segments = buildSegments(option)
  return (
    <div className="flex h-[28px] w-full items-stretch gap-[3px]" aria-hidden>
      {segments.map((s, i) => (
        <span
          key={i}
          className={
            s.kind === 'ride'
              ? 'flex min-w-[34px] origin-left items-center justify-center overflow-hidden rounded-[8px] border-2 border-ink-black px-4 font-mono text-[11px] font-bold leading-none'
              : 'flex min-w-[14px] origin-left items-center justify-center rounded-[8px] border-2 border-dashed border-ink-black/35'
          }
          style={{
            flexGrow: s.min,
            flexBasis: 0,
            ...(s.kind === 'ride'
              ? { backgroundColor: s.color, color: '#fff', textShadow: '0 0 2px rgba(0,0,0,.45)' }
              : {}),
            animation: `stripGrow 320ms var(--ease-out) ${120 + i * 50}ms both`,
          }}
        >
          {s.kind === 'ride' ? <span className="truncate">{s.label}</span> : null}
        </span>
      ))}
    </div>
  )
}

function OptionCard({
  option, index, fastest, onOpen,
}: {
  option: JourneyOption
  index: number
  fastest: boolean
  onOpen: (option: JourneyOption) => void
}) {
  const { t, lang } = useLang()
  const nTransfers = option.legs.length - 1
  const transfersLabel =
    nTransfers === 0 ? t('plan.transfers.0')
    : nTransfers === 1 ? t('plan.transfers.1')
    : `${nTransfers} ${t('plan.transfers.n')}`
  const walkTotal =
    (option.startWalk?.walkMin ?? 0) +
    (option.endWalk?.walkMin ?? 0) +
    option.transfers.reduce((n, tr) => n + tr.walkMin, 0)

  return (
    <li style={{ animation: `cardEnter 250ms var(--ease-out) ${index * 60}ms both` }}>
      <button
        type="button"
        onClick={() => onOpen(option)}
        className="
          plate pressable w-full rounded-[24px] p-16 text-left
          hover:bg-leaf-wash/50
          focus:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-band focus-visible:ring-offset-2 focus-visible:ring-offset-linen-canvas
        "
      >
        <div className="flex items-end justify-between gap-14">
          <div className="min-w-0">
            {fastest && (
              <span className="mb-8 inline-block rounded-full-2 border-2 border-ink-black bg-lime-spark px-10 py-[2px] font-mono text-[10px] font-bold uppercase leading-[14px] tracking-[0.12em] text-ink-black">
                {t('plan.fastest')}
              </span>
            )}
            <span className="block font-mono text-[28px] font-bold leading-none tracking-[-0.03em] text-ink-black tabular-nums">
              {option.depTime}
              <span className="mx-8 text-sage-mute/40">→</span>
              {option.arrTime}
            </span>
          </div>
          <span className="shrink-0 text-right font-mono text-[22px] font-bold leading-none tracking-[-0.02em] text-ink-black tabular-nums">
            {formatDuration(option.totalMin, lang)}
          </span>
        </div>

        <div className="mt-16">
          <JourneyStrip option={option} />
        </div>

        <p className="mt-12 flex items-center justify-between gap-10 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-sage-mute">
          <span className="min-w-0 truncate">
            {transfersLabel}
            {walkTotal > 0 && <> · {walkTotal} min {t('plan.walk')}</>}
          </span>
          <span className="flex shrink-0 items-center gap-4 text-ink-black">
            {t('plan.details')}
            <svg aria-hidden className="h-[12px] w-[12px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </span>
        </p>
      </button>
    </li>
  )
}

function SkeletonCard() {
  return (
    <div className="rounded-[24px] border-2 border-ink-black/15 p-16">
      <div className="flex justify-between">
        <div className="h-[28px] w-[170px] animate-pulse rounded-[8px] bg-concrete-tile/30" />
        <div className="h-[22px] w-[56px] animate-pulse rounded-[8px] bg-concrete-tile/30" />
      </div>
      <div className="mt-16 h-[28px] animate-pulse rounded-[8px] bg-concrete-tile/20" />
      <div className="mt-12 h-[12px] w-[120px] animate-pulse rounded-[6px] bg-concrete-tile/20" />
    </div>
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
      <h2 className="font-sans text-[24px] font-extrabold leading-tight tracking-[-0.025em] text-ink-black">
        {t('places.title')}
      </h2>
      <p className="mt-4 font-sans text-[13px] leading-relaxed text-sage-mute">
        {t('places.desc')}
      </p>

      {/* Category segmented control */}
      <div role="tablist" className="mt-16 flex gap-8">
        {CATEGORY_META.map(c => {
          const active = category === c.id
          return (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setCategory(c.id)}
              className="h-[40px] flex-1 rounded-full-2 border-2 border-ink-black px-8 font-sans text-[13px] font-bold active:scale-[0.96]"
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

      <div className="mt-16">
        {error && (
          <p className="font-sans text-body-sm text-sage-mute">{t('places.failed')}</p>
        )}
        {!data && !error && (
          <div className="space-y-10" aria-label={t('places.loading')}>
            {[0, 1, 2].map(i => (
              <div key={i} className="h-[68px] animate-pulse rounded-[20px] border-2 border-ink-black/15 bg-concrete-tile/20" />
            ))}
          </div>
        )}
        {data && (
          // key resets the stagger when the category changes
          <ul key={category} className="space-y-12">
            {places.map((p, i) => {
              const line = p.access.network === 'rapid-rail-kl' ? getRailLine(p.access.stop_id) : null
              const dist = p.access.distance_m == null ? null : Math.round(p.access.distance_m)
              const walkMin = dist == null ? null : Math.max(1, Math.round(dist / 80)) // ~80 m/min
              const cat = CATEGORY_META.find(c => c.id === category)!
              return (
                <li key={p.id} style={{ animation: `cardEnter 200ms var(--ease-out) ${Math.min(i, 8) * 30}ms both` }}>
                  <button
                    type="button"
                    onClick={() => onPick(p)}
                    // Concentric radii: outer 20 = inner 8 + 12 padding, so the tile's
                    // curve sits parallel to the card's instead of fighting it.
                    className="plate pressable-sm flex w-full items-center gap-[14px] rounded-[20px] p-[12px] pr-[14px] text-left hover:bg-leaf-wash/50"
                  >
                    {/* The number that matters: how far the station is on foot */}
                    <span
                      className="flex h-[56px] w-[56px] shrink-0 flex-col items-center justify-center gap-[3px] rounded-[8px] border-2 border-ink-black"
                      style={{ backgroundColor: cat.fill }}
                    >
                      <span className="font-mono text-[22px] font-bold leading-[20px] tracking-[-0.04em] text-ink-black tabular-nums">
                        {walkMin ?? '-'}
                      </span>
                      <span className="font-mono text-[9px] font-bold uppercase leading-[10px] tracking-[0.1em] text-ink-black/65">
                        min
                      </span>
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-[6px]">
                      <span className="truncate font-sans text-[16px] font-extrabold leading-[20px] tracking-[-0.015em] text-ink-black">
                        {p.name}
                      </span>
                      <span className="flex min-w-0 items-center gap-[6px] font-sans text-[12px] font-medium leading-[18px] text-sage-mute">
                        {line && (
                          <span
                            className="shrink-0 rounded-[5px] px-[5px] font-mono text-[10px] font-bold leading-[18px] text-white-plate"
                            style={{ backgroundColor: line.color }}
                          >
                            {line.type}
                          </span>
                        )}
                        <span className="truncate">{p.access.stop_name}</span>
                        {dist != null && (
                          <span className="shrink-0 font-mono text-[11px] text-sage-mute/70 tabular-nums">
                            {dist} m
                          </span>
                        )}
                      </span>
                    </span>
                    <svg aria-hidden className="h-[12px] w-[12px] shrink-0 text-ink-black/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
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
  const options = result?.options ?? []
  const minTotal = options.length > 1 ? Math.min(...options.map(o => o.totalMin)) : null

  return (
    <div className="min-h-dvh bg-linen-canvas">
      <PageHeader />
      <div className="mx-auto max-w-md px-20 pb-128 lg:max-w-2xl lg:pb-64">

        {/* ── Hero ── */}
        <div className="pt-26" style={{ animation: 'riseIn 340ms var(--ease-out) both' }}>
          <h1 className="font-sans text-[44px] font-extrabold leading-[1] tracking-[-0.04em] text-ink-black">
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

        {/* ── Route ticket ── */}
        <div className="mt-24" style={{ animation: 'riseIn 340ms var(--ease-out) 80ms both' }}>
          <div className="plate shadow-plate relative overflow-hidden rounded-[28px]">
            {/* Dashed spine between the two markers (centres at 34px and 102px) */}
            <span
              aria-hidden
              className="absolute left-[25px] top-[34px] h-[68px] border-l-2 border-dashed border-ink-black/40"
            />
            <TicketRow
              label={t('plan.from')}
              stop={from}
              placeholder={t('plan.pickStop')}
              onClick={() => setPicker('from')}
              marker={<OriginMarker stop={from} />}
            />
            <TicketRow
              label={t('plan.to')}
              stop={to}
              placeName={toPlace}
              placeholder={t('plan.pickStop')}
              onClick={() => setPicker('to')}
              marker={<DestinationMarker />}
            />

            {/* Swap - pinned on the right, centred on the seam */}
            <button
              type="button"
              aria-label={t('plan.swap')}
              onClick={swap}
              disabled={!from && !to}
              className="
                plate pressable-sm absolute right-14 top-1/2 z-10 flex h-[44px] w-[44px] -translate-y-1/2
                items-center justify-center rounded-full-3 bg-lime-spark text-ink-black
                disabled:opacity-40
              "
            >
              <svg aria-hidden className="h-[18px] w-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
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
                mt-14 flex h-[44px] items-center gap-8 rounded-full-2 border-2 border-ink-black bg-white-plate
                px-16 font-sans text-[14px] font-bold text-ink-black active:scale-[0.96]
                disabled:opacity-60
              "
              style={{ transition: 'transform 140ms var(--ease-out)' }}
            >
              <svg aria-hidden className="h-[16px] w-[16px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
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
            <p className="px-4 font-sans text-body-sm leading-relaxed text-sage-mute">
              {t('plan.intro')}
            </p>
          )}

          {loading && (
            <div className="space-y-14" role="status" aria-label={t('plan.loading')}>
              <SkeletonCard />
              <SkeletonCard />
            </div>
          )}

          {failed && (
            <p className="text-center font-sans text-body-sm text-sage-mute">
              {t('plan.failed')}
            </p>
          )}

          {result && !result.supported && (
            <div className="rounded-[20px] border-2 border-ink-black bg-mustard-pop p-18">
              <p className="font-sans text-body-sm font-bold leading-relaxed text-ink-black">
                {t('plan.busCross')}
              </p>
            </div>
          )}

          {result && result.supported && result.options.length === 0 && (
            <p className="rounded-[20px] border-2 border-dashed border-ink-black/30 p-18 text-center font-sans text-body-sm leading-relaxed text-sage-mute">
              {t('plan.none')}
            </p>
          )}

          {options.length > 0 && (
            <>
              <ol className="space-y-16">
                {options.map((o, i) => (
                  <OptionCard
                    key={i}
                    option={o}
                    index={i}
                    fastest={minTotal !== null && o.totalMin === minTotal && i === options.findIndex(x => x.totalMin === minTotal)}
                    onOpen={setDetailOption}
                  />
                ))}
              </ol>
              <p className="mt-18 text-center font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-sage-mute/80">
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
