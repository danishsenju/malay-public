'use client'

import { useEffect, useRef, useState } from 'react'

interface FlapDigitProps {
  value: string   // one character: digit, letter, space, colon
  delay?: number  // ms to wait before starting this digit's flip (stagger)
}

/**
 * One character cell that animates like a physical split-flap board when its
 * value changes. Uses a two-phase CSS transition: rotates to -90° (current
 * character disappears), swaps the character, then rotates back to 0°
 * (new character appears). No keyframes — CSS transitions retarget mid-flight,
 * which is essential for a component that receives live arrival-time updates.
 *
 * prefers-reduced-motion: globals.css sets transition-duration: 0.01ms !important,
 * which makes the flip imperceptibly fast (instant swap with no visible rotation).
 */
export function FlapDigit({ value, delay = 0 }: FlapDigitProps) {
  const [shown, setShown] = useState(value)
  const [isOut, setIsOut] = useState(false)

  // Hold the latest target value; read in onTransitionEnd to avoid stale closure.
  const next  = useRef(value)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    next.current = value
    if (value === shown) return

    clearTimeout(timer.current)
    timer.current = setTimeout(() => setIsOut(true), delay)

    return () => clearTimeout(timer.current)
  }, [value, shown, delay])

  function handleTransitionEnd() {
    if (!isOut) return
    // Mid-flip (element is now at -90°): swap character and rotate back to 0°.
    clearTimeout(timer.current)
    setShown(next.current)
    setIsOut(false)
  }

  return (
    <span
      style={{
        display: 'inline-block',
        // perspective() in the transform (not on parent) so each digit has its
        // own vanishing point — correct for a mechanism where each flap is
        // physically independent.
        transform: isOut
          ? 'perspective(400px) rotateX(-90deg)'
          : 'perspective(400px) rotateX(0deg)',
        transition: 'transform 220ms var(--ease-in-out)',
        transformStyle: 'preserve-3d',
      }}
      onTransitionEnd={handleTransitionEnd}
    >
      {shown}
    </span>
  )
}
