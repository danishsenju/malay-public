'use client'

import { useCallback, useState, useSyncExternalStore } from 'react'
import { NearbySection } from './NearbySection'
import { NetworkPulse } from './NetworkPulse'
import { HeaderNav } from './AppNav'
import { BrandMark } from './BrandMark'
import { SearchBar } from './SearchBar'
import { SearchOverlay } from './SearchOverlay'
import { SavedSection } from './SavedSection'
import { SmartCommuteCard } from './SmartCommuteCard'
import { StopSheet } from './StopSheet'
import { useCommutePattern } from '@/hooks/useCommutePattern'
import { useSavedStops } from '@/hooks/useSavedStops'
import { useLang, LangToggle, type Lang } from '@/lib/i18n'
import { STRINGS, DAYS, MONTHS, QUOTES, type StringKey } from '@/lib/strings'
import type { Arrival, NearbyStop } from '@/lib/types'

// ── Time-aware greeting + date eyebrow ──────────────────────────────────────

function greetKeyFor(h: number): StringKey {
  if (h >= 5 && h < 12) return 'home.greet.morning'
  if (h >= 12 && h < 15) return 'home.greet.midday'
  if (h >= 15 && h < 19) return 'home.greet.evening'
  return 'home.greet.night'
}

interface Clock {
  greetHead: string
  greetTail: string
  dateLabel: string
  quote: string
}

// One positive quote per visit. Chosen once on the client (this whole snapshot
// is client-only - getServerClock returns null - so there's no SSR/hydration
// mismatch) and shared across languages, so toggling BM/EN keeps the same line.
let quoteIndex: number | null = null

// Client-only snapshot: null during SSR/hydration, then the greeting for the
// moment the page loaded. Cached per language so getSnapshot stays
// referentially stable between renders.
const emptySubscribe = () => () => {}
const getServerClock = () => null
const clockCache: Partial<Record<Lang, Clock>> = {}
function clockSnapshotFor(lang: Lang): Clock {
  let snap = clockCache[lang]
  if (!snap) {
    if (quoteIndex === null) quoteIndex = Math.floor(Math.random() * QUOTES.length)
    const d = new Date()
    const [head, ...rest] = STRINGS[lang][greetKeyFor(d.getHours())].split(' ')
    snap = {
      greetHead: head,
      greetTail: rest.join(' '),
      dateLabel: `${DAYS[lang][d.getDay()]} · ${d.getDate()} ${MONTHS[lang][d.getMonth()]}`,
      quote: QUOTES[quoteIndex][lang],
    }
    clockCache[lang] = snap
  }
  return snap
}

// ── Ticker ──────────────────────────────────────────────────────────────────
// Decorative → aria-hidden. On desktop it stays within the left column
// (lg:mx-0 + lg:rounded-lg); on mobile it bleeds edge-to-edge (mx-[-20px]).

const TICKER_ITEMS: Record<Lang, string[]> = {
  ms: ['LRT', 'MRT', 'MONOREL', 'KTM KOMUTER', 'BAS RAPIDKL', 'MASA NYATA'],
  en: ['LRT', 'MRT', 'MONORAIL', 'KTM KOMUTER', 'RAPIDKL BUS', 'REAL-TIME'],
}

function Ticker({ lang }: { lang: Lang }) {
  const run = TICKER_ITEMS[lang].map(t => `${t} ◆ `).join('')
  return (
    <div
      aria-hidden
      className="mx-[-20px] overflow-hidden border-y-2 border-ink-black bg-lime-spark py-1.75 lg:mx-0 lg:rounded-lg lg:border-2"
    >
      <div className="marquee-track">
        <span className="whitespace-nowrap font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-ink-black">
          {run}
        </span>
        <span className="whitespace-nowrap font-mono text-[11px] font-bold uppercase tracking-[0.22em] text-ink-black">
          {run}
        </span>
      </div>
    </div>
  )
}

// ── Layout ──────────────────────────────────────────────────────────────────

export function HomeLayout() {
  const { lang } = useLang()
  const [selectedStop, setSelectedStop] = useState<NearbyStop | null>(null)
  // Set when the tap was on a specific arrival card - the sheet then opens
  // straight into that arrival's mini live map.
  const [selectedArrival, setSelectedArrival] = useState<Arrival | null>(null)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const { saved, save, remove, isSaved, hydrated } = useSavedStops()
  const { prediction, recordVisit } = useCommutePattern()

  // Every stop the user opens feeds the on-device routine learner.
  function openStop(stop: NearbyStop, arrival?: Arrival) {
    recordVisit(stop)
    setSelectedStop(stop)
    setSelectedArrival(arrival ?? null)
  }

  const getClockSnapshot = useCallback(() => clockSnapshotFor(lang), [lang])
  const clock = useSyncExternalStore(emptySubscribe, getClockSnapshot, getServerClock)

  return (
    <>
      {/* ── Masthead - expands to max-w-6xl on desktop ───────────────────── */}
      <header className="sticky top-0 z-20 bg-linen-canvas/85 px-16 pb-10 pt-3 backdrop-blur-md lg:px-[32px]">
        <div className="mx-auto max-w-md lg:max-w-6xl">
          <div className="plate shadow-plate-sm flex items-center justify-between rounded-full-2 py-2.25 pl-2.5 pr-18">
            <BrandMark />

            {/* Desktop: nav lives in the masthead pill itself */}
            <HeaderNav />

            <span className="flex items-center gap-8">
              {/* Language switch */}
              <LangToggle />

              {/* LIVE chip */}
              <span className="flex items-center gap-1.75 rounded-full-2 border-2 border-ink-black bg-lime-spark px-10 py-0.75">
                <span className="relative flex h-1.75 w-1.75" aria-hidden>
                  <span
                    className="absolute inset-0 rounded-full-3 bg-forest-ink"
                    style={{ animation: 'livePulseRing 2s ease-out infinite' }}
                  />
                  <span className="relative h-1.75 w-1.75 rounded-full-3 bg-forest-ink" />
                </span>
                <span className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-ink-black">
                  Live
                </span>
              </span>
            </span>
          </div>
        </div>
      </header>

      {/* ── Page content ─────────────────────────────────────────────────── */}
      <div className="mx-auto max-w-md px-20 pb-128 lg:max-w-6xl lg:px-[32px] lg:pb-[80px]">

        {/* Desktop: 2-column grid. Mobile: single column. */}
        <div className="lg:grid lg:grid-cols-[420px_1fr] lg:items-start lg:gap-x-48">

          {/* ── LEFT COLUMN - hero + ticker + search + saved ─────────────── */}
          {/* Sticky on desktop so search + saved stay visible while the user
              scrolls through nearby arrivals on the right. */}
          <div className="lg:sticky lg:top-17 lg:pb-40">

            {/* Editorial hero */}
            <div className="pt-26" style={{ animation: 'riseIn 340ms var(--ease-out) both' }}>
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-sage-mute">
                {clock?.dateLabel ?? ' '}
              </p>
              <h1 className="mt-10 font-sans text-[44px] font-extrabold leading-[1.02] tracking-[-0.03em] text-ink-black">
                {clock ? (
                  <>
                    {clock.greetHead}
                    <br />
                    <span className="relative inline-block">
                      {/* Highlighter swipe - scaleX reveal from the left */}
                      <span
                        aria-hidden
                        className="-inset-x-1.5 absolute bottom-0.75 h-[0.42em] origin-left rounded-lg bg-lime-spark"
                        style={{ animation: 'highlightIn 380ms var(--ease-out) 300ms both' }}
                      />
                      <span className="relative">{clock.greetTail}.</span>
                    </span>
                  </>
                ) : (
                  ' '
                )}
              </h1>

              {/* Feel-good line - a small positive nudge under the greeting.
                  Seen every home visit, so it rides the hero's riseIn and adds
                  no motion of its own (Emil: frequency rule). */}
              {clock?.quote && (
                <p className="mt-14 max-w-[36ch] font-sans text-body-sm font-medium leading-relaxed text-sage-mute">
                  {clock.quote}
                </p>
              )}
            </div>

            {/* Ticker band */}
            <div className="mt-24" style={{ animation: 'riseIn 340ms var(--ease-out) 60ms both' }}>
              <Ticker lang={lang} />
            </div>

            {/* Search */}
            <div className="mt-24" style={{ animation: 'riseIn 340ms var(--ease-out) 120ms both' }}>
              <SearchBar onClick={() => setIsSearchOpen(true)} />
            </div>

            {/* Network Pulse - the live heartbeat of the whole country */}
            <div className="mt-24" style={{ animation: 'riseIn 340ms var(--ease-out) 160ms both' }}>
              <NetworkPulse />
            </div>

            {/* Smart Commute - the zero-tap answer, learned on-device */}
            {prediction && (
              <div className="mt-48">
                <SmartCommuteCard stop={prediction.stop} onSelect={openStop} />
              </div>
            )}

            {/* Saved stops */}
            <div className="mt-48">
              {hydrated && <SavedSection stops={saved} onSelect={openStop} />}
            </div>
          </div>

          {/* ── RIGHT COLUMN - nearby stops ──────────────────────────────── */}
          {/* mt-48 on mobile (stacked below saved); pt-26 on desktop (aligns
              with the hero top inside the left column). */}
          <div className="mt-48 lg:mt-0 lg:pt-26">
            <NearbySection onSelectStop={openStop} />
          </div>
        </div>
      </div>

      {/* ── Full-screen search overlay ───────────────────────────────────── */}
      <SearchOverlay
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onSelect={stop => {
          setIsSearchOpen(false)
          openStop(stop)
        }}
      />

      {/* ── Stop detail sheet - shared across search, saved, nearby ─────── */}
      <StopSheet
        stop={selectedStop}
        onClose={() => { setSelectedStop(null); setSelectedArrival(null) }}
        isSaved={selectedStop ? isSaved(selectedStop) : false}
        onSave={save}
        onRemove={remove}
        initialArrival={selectedArrival}
      />
    </>
  )
}
