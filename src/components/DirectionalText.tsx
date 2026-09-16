'use client'

import { splitDirectional } from '@/lib/transit'

/**
 * Renders directional GTFS names - "KL SENTRAL KE ARAH SEREMBAN",
 * "From Putra Heights to Gombak", "Pasar Seni → KLCC" - as the neutral
 *   ORIGIN  <→>  DESTINATION
 * with a dim separator so the destination reads first. Language-neutral, so
 * feed text never leaks BM into the EN UI or vice versa.
 */
export function DirectionalText({ text }: { text: string }) {
  const parts = splitDirectional(text)
  if (!parts) return <>{text}</>
  return (
    <>
      {parts[0]}
      <span className="mx-1.5 font-normal text-sage-mute/60">→</span>
      {parts[1]}
    </>
  )
}
