'use client'

import Link from 'next/link'
import { BrandMark } from './BrandMark'
import { HeaderNav } from './AppNav'
import { useLang, LangToggle } from '@/lib/i18n'

/**
 * Shared masthead for every non-home page - the exact same single plate pill
 * as HomeLayout's masthead (identity · desktop nav · controls), with a
 * back-to-home arrow standing in for the home tab these pages don't otherwise
 * have. Sticky, so navigation stays reachable while scrolling - matching
 * home's behaviour instead of the "back button + scattered elements" pattern
 * these pages used before, which had no desktop nav at all.
 *
 * Widened to lg:max-w-6xl (matching home) rather than these pages' own
 * lg:max-w-2xl body column - the five-link nav needs ~730px alone, and at
 * 2xl it was crushing LangToggle to zero width via flex-shrink. A header bar
 * wider than the narrow reading column beneath it is a normal pattern.
 */
export function PageHeader() {
  const { t } = useLang()
  return (
    <header className="sticky top-0 z-20 bg-linen-canvas/85 px-16 pb-10 pt-3 backdrop-blur-md lg:px-[32px]">
      <div className="mx-auto max-w-md lg:max-w-6xl">
        <div className="plate shadow-plate-sm flex items-center justify-between rounded-full-2 py-2.25 pl-2.5 pr-18">
          <span className="flex items-center gap-8">
            <Link
              href="/"
              aria-label={t('common.backHome')}
              className="pressable-sm flex h-40 w-40 shrink-0 items-center justify-center rounded-full-3 text-ink-black"
            >
              <svg aria-hidden className="h-18 w-18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <BrandMark />
          </span>

          {/* Desktop: nav lives in the masthead pill itself */}
          <HeaderNav />

          <LangToggle />
        </div>
      </div>
    </header>
  )
}
