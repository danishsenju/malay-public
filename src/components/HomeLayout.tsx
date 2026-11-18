'use client'

import { useCallback, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { NearbySection } from './NearbySection'
import { HomeStatusGrid } from './HomeStatusGrid'
import { HeaderNav, ReportButton } from './AppNav'
import { BrandMark } from './BrandMark'
import { SearchBar } from './SearchBar'
import { SearchOverlay } from './SearchOverlay'
import { SavedSection } from './SavedSection'
import { SmartCommuteCard } from './SmartCommuteCard'
import { StopSheet } from './StopSheet'
import { useCommutePattern } from '@/hooks/useCommutePattern'
import { useGeolocation } from '@/hooks/useGeolocation'
import { useSavedStops } from '@/hooks/useSavedStops'
import { useLang, LangToggle, type Lang } from '@/lib/i18n'
import { STRINGS, DAYS, MONTHS, QUOTES, type StringKey } from '@/lib/strings'
import type { Arrival, NearbyStop } from '@/lib/types'

/**
 * Home, ordered by what a rider opened the app to find out:
 *   1. a one-glance greeting (who/when - brand voice, kept small)
 *   2. search
 *   3. the status bento (is it moving / flooding / storming / broken)
 *   4. their own stops (learned routine, saved)
 *   5. arrivals near them
 *
 * Before this, the arrivals sat ~1,500px down a phone, below a 44px hero, a
 * scrolling ticker and a large vehicle-count card. On mobile the personal
 * answers now start inside the first screen.
 *
 * Desktop: two columns - the "situation" column (greeting, search, status)
 * stays put while the stops/arrivals column scrolls.
 *
 * Motion (Emil's frequency rule): Home is opened dozens of times a day, so
 * nothing here re-animates on every visit - no hero rise, no highlighter
 * swipe, no marquee. The once-per-session splash carries the brand moment;
 * arrival cards still ease in because they replace a loading skeleton.
 */

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

// ── Layout ──────────────────────────────────────────────────────────────────

export function HomeLayout() {
  const { t, lang } = useLang()
  const [selectedStop, setSelectedStop] = useState<NearbyStop | null>(null)
  // Set when the tap was on a specific arrival card - the sheet then opens
  // straight into that arrival's mini live map.
  const [selectedArrival, setSelectedArrival] = useState<Arrival | null>(null)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const { saved, save, remove, isSaved, hydrated } = useSavedStops()
  const { prediction, recordVisit } = useCommutePattern()
  // One location request for the whole screen: the flood banner and the nearby
  // stops both read it.
  const geo = useGeolocation()

  // Every stop the user opens feeds the on-device routine learner.
  function openStop(stop: NearbyStop, arrival?: Arrival) {
    recordVisit(stop)
    setSelectedStop(stop)
    setSelectedArrival(arrival ?? null)
  }

  const getClockSnapshot = useCallback(() => clockSnapshotFor(lang), [lang])
  const clock = useSyncExternalStore(emptySubscribe, getClockSnapshot, getServerClock)

  const footnote = (
    <p className="font-mono text-[10px] font-medium uppercase leading-relaxed tracking-[0.08em] text-sage-mute/80">
      {t('home.footnote')} <Link href="/status" className="underline underline-offset-2">/status</Link>
    </p>
  )

  return (
    <>
      {/* ── Masthead ─────────────────────────────────────────────────────── */}
      <header
        className="sticky top-0 z-20 bg-linen-canvas/85 px-16 pb-10 backdrop-blur-md lg:px-[32px]"
        // viewport-fit=cover lets the page run under the notch; pad the bar back out.
        style={{ paddingTop: 'max(12px, env(safe-area-inset-top))' }}
      >
        <div className="mx-auto max-w-md lg:max-w-6xl">
          <div className="plate shadow-plate-sm flex items-center justify-between rounded-full-2 py-2.25 pl-2.5 pr-18">
            <BrandMark />

            {/* Desktop: nav lives in the masthead pill itself */}
            <HeaderNav />

            <span className="flex items-center gap-8">
              <LangToggle />
              {/* Daily Report - the masthead CTA */}
              <ReportButton />
            </span>
          </div>
        </div>
      </header>

      {/* ── Page content ─────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-md px-20 pb-128 lg:max-w-6xl lg:px-[32px] lg:pb-[80px]">
        <div className="lg:grid lg:grid-cols-[400px_1fr] lg:items-start lg:gap-x-48">

          {/* ── Situation column: greeting · search · status ─────────────── */}
          {/* Sticky on desktop - short enough to always fit under the masthead. */}
          <div className="lg:sticky lg:top-[84px] lg:pb-40">
            <div className="pt-18">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-sage-mute">
                {clock?.dateLabel ?? ' '}
              </p>
              {/* One compact line on most phones; the highlighter is static -
                  it's identity, not news, so it doesn't replay every visit. */}
              <h1 className="mt-8 font-sans text-[32px] font-extrabold leading-[1.05] tracking-[-0.03em] text-ink-black lg:text-[40px]">
                {clock ? (
                  <>
                    {clock.greetHead}{' '}
                    <span className="relative inline-block whitespace-nowrap">
                      <span
                        aria-hidden
                        className="-inset-x-1 absolute bottom-0.5 h-[0.4em] rounded-lg bg-lime-spark"
                        style={{ transform: 'rotate(-1deg)' }}
                      />
                      <span className="relative">{clock.greetTail}.</span>
                    </span>
                  </>
                ) : (
                  ' '
                )}
              </h1>
              {clock?.quote && (
                <p className="mt-8 max-w-[40ch] font-sans text-body-sm leading-relaxed text-sage-mute">
                  {clock.quote}
                </p>
              )}
            </div>

            <div className="mt-18">
              <SearchBar onClick={() => setIsSearchOpen(true)} />
            </div>

            <div className="mt-18">
              <HomeStatusGrid geo={geo} />
            </div>

            <div className="mt-26 hidden lg:block">{footnote}</div>
          </div>

          {/* ── Rider column: routine · saved · nearby ───────────────────── */}
          <div className="mt-40 space-y-40 lg:mt-0 lg:pt-18">
            {/* Smart Commute - the zero-tap answer, learned on-device */}
            {prediction && <SmartCommuteCard stop={prediction.stop} onSelect={openStop} />}

            {/* Saved stops are a personal answer - above nearby once they exist.
                While empty it's only an invitation, so it waits below the
                arrivals instead of pushing them down the first screen. */}
            {hydrated && saved.length > 0 && <SavedSection stops={saved} onSelect={openStop} />}

            <NearbySection geo={geo} onSelectStop={openStop} />

            {hydrated && saved.length === 0 && <SavedSection stops={saved} onSelect={openStop} />}

            <div className="lg:hidden">{footnote}</div>
          </div>
        </div>
      </main>

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
