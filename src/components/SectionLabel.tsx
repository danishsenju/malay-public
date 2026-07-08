'use client'

import type { ReactNode } from 'react'

interface SectionLabelProps {
  children: ReactNode
  /** Optional right-aligned meta (count or location) — mono, muted. */
  trailing?: ReactNode
}

/**
 * Section eyebrow as a stamped tag: a white pill with an ink stroke and a small
 * hard shadow — reads like a label physically stuck onto the canvas. Trailing
 * meta sits quiet on the right so the tag stays the anchor.
 */
export function SectionLabel({ children, trailing }: SectionLabelProps) {
  return (
    <div className="flex items-center justify-between gap-14">
      <span className="plate shadow-plate-sm inline-flex items-center rounded-full-2 px-14 py-1.25 font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-ink-black">
        {children}
      </span>
      {trailing != null && (
        <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-sage-mute tabular-nums">
          {trailing}
        </span>
      )}
    </div>
  )
}
