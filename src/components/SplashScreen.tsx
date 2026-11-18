'use client'

import Image from 'next/image'
import { useCallback, useEffect, useRef, useState } from 'react'
import { FlapDigit } from './FlapDigit'

/**
 * Launch splash - once per browser session, never twice.
 *
 * Frequency (Emil): an app is opened dozens of times a day, so this can't be a
 * ritual. It plays on the first load of a session only (sessionStorage), lasts
 * ~1.2s, and any tap or key skips it. A returning session never sees it - an
 * inline script in layout.tsx hides it before first paint, so there is no flash.
 *
 * Motion vocabulary - all taken from the app itself, nothing new bolted on:
 *   1. Land      the logo sticker drops onto the linen: it starts a touch
 *                larger with its hard shadow further away, and settles into
 *                the resting plate (a CSS animation, so it plays at first
 *                paint, before any JavaScript has loaded).
 *   2. Board     "TransitMY" flips in letter by letter, the same split-flap
 *                mechanism as the arrival countdowns. It starts when React is
 *                hydrated, so the board only moves once the app is actually
 *                alive - the splash never plays over a dead page.
 *   3. Settle    the lime highlighter swipes under the word (as in every page
 *                hero) and the tagline rises in.
 *   4. Exit      one quick fade: exit is faster than enter (200ms vs ~900ms).
 *
 * Only transform + opacity move. Reduced motion keeps a short opacity fade and
 * drops everything that travels (see globals.css).
 */

const WORD = 'TransitMY'
const NBSP = ' ' // a plain space collapses inside an inline-block cell
const SEEN_KEY = 'transitmy:splash'
const EXIT_MS = 200

type Phase = 'idle' | 'board' | 'settled' | 'exit' | 'done'

const TIMELINE = {
  full:    { board: 120, settled: 560, exit: 1000 },
  reduced: { board: 0,   settled: 120, exit: 650 },
} as const

export function SplashScreen() {
  const [phase, setPhase] = useState<Phase>('idle')
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const leaving = useRef(false)

  const leave = useCallback((instant = false) => {
    if (leaving.current) return
    leaving.current = true
    try { sessionStorage.setItem(SEEN_KEY, '1') } catch {}
    // Keyboard-initiated: no animation at all, it's a repeated action.
    if (instant) { setPhase('done'); return }
    setPhase('exit')
    timers.current.push(setTimeout(() => setPhase('done'), EXIT_MS))
  }, [])

  useEffect(() => {
    leaving.current = false
    const later = (ms: number, fn: () => void) => { timers.current.push(setTimeout(fn, ms)) }

    let seen = false
    try { seen = sessionStorage.getItem(SEEN_KEY) === '1' } catch {}

    if (seen) {
      // The layout script already hid it; just unmount. (setState only ever
      // runs inside timer callbacks - the react-hooks lint rule is strict.)
      later(0, () => setPhase('done'))
    } else {
      const t = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? TIMELINE.reduced : TIMELINE.full
      later(t.board, () => setPhase('board'))
      later(t.settled, () => setPhase('settled'))
      later(t.exit, () => leave())
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') leave(true)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      timers.current.forEach(clearTimeout)
      timers.current = []
      window.removeEventListener('keydown', onKey)
    }
  }, [leave])

  if (phase === 'done') return null

  return (
    <div
      aria-hidden
      data-phase={phase}
      onPointerDown={() => leave()}
      className="splash-root fixed inset-0 z-100 flex items-center justify-center bg-linen-canvas"
    >
      <div className="splash-inner flex flex-col items-center">
        {/* Logo sticker - ink shadow plate behind, sticker on top. */}
        <div className="relative h-[112px] w-[112px]">
          <span aria-hidden className="splash-shadow absolute inset-0 rounded-[26px] bg-ink-black" />
          <span className="splash-sticker relative block h-full w-full overflow-hidden rounded-[26px] border-[3px] border-ink-black bg-ink-black">
            {/* The art sits on a black margin; 1.12 crops it away so the
                ring hugs the navy tile (same trick as BrandMark's object-cover). */}
            <Image
              src="/transitMY-logo.jpeg"
              alt=""
              width={224}
              height={224}
              priority
              className="h-full w-full scale-[1.12] object-cover"
            />
          </span>
        </div>

        {/* Departure-board wordmark */}
        <div className="relative mt-26 inline-block">
          <span
            aria-hidden
            className="splash-mark absolute -inset-x-1.5 bottom-0.5 h-[0.42em] rounded-lg bg-lime-spark"
          />
          <span className="relative flex font-mono text-[30px] font-bold leading-none tracking-[-0.01em] text-ink-black">
            {[...WORD].map((ch, i) => (
              <FlapDigit key={i} value={phase === 'idle' ? NBSP : ch} delay={i * 30} />
            ))}
          </span>
        </div>

        {/* The brand's own question, in the voice of the app */}
        <p className="splash-tagline mt-14 font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-sage-mute">
          Sampai bila?
        </p>
      </div>
    </div>
  )
}
