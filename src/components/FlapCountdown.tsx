'use client'

import { FlapDigit } from './FlapDigit'

interface FlapCountdownProps {
  minutes: number
  className?: string
}

/**
 * Formats minutes as a fixed 6-character string so digit positions are stable
 * across every possible value. Stable positions = stable React keys = the same
 * DOM element animates between values instead of unmounting and remounting.
 *
 * Character map (positions 0–5):
 *   ' 4 min'  →  [' ','4',' ','m','i','n']   (1–9 minutes)
 *   '12 min'  →  ['1','2',' ','m','i','n']   (10–99 minutes)
 *   '   ARR'  →  [' ',' ',' ','A','R','R']   (≤ 0 minutes)
 *
 * When ticking from 10 → 9: pos 0 flips '1'→' ', pos 1 flips '0'→'9' — two
 * simultaneous flip animations, staggered by 40ms each.
 * When ticking from 1 → ARR: pos 1 flips '1'→' ', pos 3 flips 'm'→'A',
 * pos 4 flips 'i'→'R', pos 5 flips 'n'→'R' — a satisfying cascade.
 */
function formatMinutes(m: number): string {
  if (m <= 0) return '   ARR'
  return String(Math.min(m, 99)).padStart(2, ' ') + ' min'
}

export function FlapCountdown({ minutes, className }: FlapCountdownProps) {
  const display = formatMinutes(minutes)

  return (
    <span className={`font-mono ${className ?? ''}`}>
      {display.split('').map((ch, i) => (
        <FlapDigit key={i} value={ch} delay={i * 40} />
      ))}
    </span>
  )
}
