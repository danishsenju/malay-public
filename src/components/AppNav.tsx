'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLang } from '@/lib/i18n'
import type { StringKey } from '@/lib/strings'

/**
 * App navigation, two renditions of one item list:
 *
 * - BottomNav (mobile) — a floating plate bar pinned above the safe area.
 *   It's on screen 100% of the time, so per Emil's frequency rule it earns
 *   NO entrance animation and no decorative motion: the only movement is
 *   press feedback (scale) and a background-color fade on the active sticker.
 * - HeaderNav (desktop ≥ lg) — the same links inline in the TransitMY
 *   masthead pill, ghost text with a lime sticker on the active route.
 *
 * Active state is colour, not motion: lime-spark is the app's single loud
 * accent, so the current tab is simply the lime one.
 */

interface NavItem {
  href: string
  label: StringKey
  icon: string
}

const ITEMS: NavItem[] = [
  { href: '/',       label: 'nav.home',   icon: 'M3 10.75 12 3l9 7.75M5.5 9.6V20a1 1 0 0 0 1 1H9.5v-5.5h5V21h3a1 1 0 0 0 1-1V9.6' },
  { href: '/map',    label: 'nav.map',    icon: 'M9 20l-5.447-2.724A1 1 0 0 1 3 16.382V5.618a1 1 0 0 1 1.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0 0 21 18.382V7.618a1 1 0 0 0-.553-.894L15 4m0 13V4M9 7l6-3' },
  { href: '/plan',   label: 'nav.plan',   icon: 'M13 5l7 7-7 7M5 5l7 7-7 7' },
  { href: '/report', label: 'nav.report', icon: 'M9 17V9m4 8V5m4 12v-4M4 21h16' },
  { href: '/status', label: 'nav.status', icon: 'M22 12h-4l-3 9L9 3l-3 9H2' },
]

function isActive(pathname: string, href: string): boolean {
  return href === '/' ? pathname === '/' : pathname.startsWith(href)
}

// ── Mobile: floating bottom bar ──────────────────────────────────────────────

export function BottomNav() {
  const { t } = useLang()
  const pathname = usePathname()

  return (
    <nav
      aria-label="Navigasi utama"
      className="fixed inset-x-0 bottom-0 z-40 px-[10px] lg:hidden"
      style={{ paddingBottom: 'max(6px, env(safe-area-inset-bottom))' }}
    >
      <div className="plate shadow-plate-sm mx-auto flex max-w-md items-center justify-between rounded-full-2 px-[6px] py-[6px]">
        {ITEMS.map(item => {
          const active = isActive(pathname, item.href)
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className="flex min-w-0 flex-1 flex-col items-center gap-[2px] rounded-full-2 py-[4px] active:scale-[0.94]"
              style={{ transition: 'transform 120ms var(--ease-out)' }}
            >
              {/* Icon sticker — lime only on the current tab */}
              <span
                className="flex h-[22px] w-[30px] items-center justify-center rounded-full-2"
                style={{
                  backgroundColor: active ? 'var(--color-lime-spark)' : 'transparent',
                  border: active ? '2px solid var(--color-ink-black)' : '2px solid transparent',
                  transition: 'background-color 150ms var(--ease-out)',
                }}
              >
                <svg
                  aria-hidden
                  className="h-[15px] w-[15px]"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}
                  style={{
                    color: active ? 'var(--color-ink-black)' : 'var(--color-sage-mute)',
                    transition: 'color 150ms var(--ease-out)',
                  }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                </svg>
              </span>
              <span
                className="font-mono text-[8px] font-bold uppercase tracking-[0.06em]"
                style={{
                  color: active ? 'var(--color-ink-black)' : 'var(--color-sage-mute)',
                  transition: 'color 150ms var(--ease-out)',
                }}
              >
                {t(item.label)}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}

// ── Desktop: inline masthead links ───────────────────────────────────────────

export function HeaderNav() {
  const { t } = useLang()
  const pathname = usePathname()

  return (
    <nav aria-label="Navigasi utama" className="hidden items-center gap-2 lg:flex">
      {ITEMS.map(item => {
        const active = isActive(pathname, item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`
              rounded-full-2 border-2 px-12 py-1 font-mono text-caption font-bold
              active:scale-[0.96]
              ${active
                ? 'border-ink-black bg-lime-spark text-ink-black'
                : 'border-transparent text-sage-mute [@media(hover:hover)_and_(pointer:fine)]:hover:bg-leaf-wash/60 [@media(hover:hover)_and_(pointer:fine)]:hover:text-ink-black'}
            `}
            style={{
              transition: 'background-color 150ms var(--ease-out), color 150ms var(--ease-out), transform 120ms var(--ease-out)',
            }}
          >
            {t(item.label)}
          </Link>
        )
      })}
    </nav>
  )
}
