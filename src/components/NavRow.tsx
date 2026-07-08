'use client'

import Link from 'next/link'

const LINKS = [
  { href: '/map',    label: 'Peta',    icon: 'M9 20l-5.447-2.724A1 1 0 0 1 3 16.382V5.618a1 1 0 0 1 1.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0 0 21 18.382V7.618a1 1 0 0 0-.553-.894L15 4m0 13V4M9 7l6-3' },
  { href: '/plan',   label: 'Rancang', icon: 'M13 5l7 7-7 7M5 5l7 7-7 7' },
  { href: '/report', label: 'Laporan', icon: 'M9 17V9m4 8V5m4 12v-4M4 21h16' },
  { href: '/status', label: 'Status',  icon: 'M22 12h-4l-3 9L9 3l-3 9H2' },
]

/**
 * Primary destinations as stamped pill links. Everything an official app
 * hides in a hamburger, we put on the table.
 */
export function NavRow() {
  return (
    <nav aria-label="Navigasi utama" className="flex flex-wrap gap-8">
      {LINKS.map(l => (
        <Link
          key={l.href}
          href={l.href}
          className="
            plate pressable-sm flex items-center gap-1.5 rounded-full-2 px-14 py-1.5
            font-mono text-caption font-bold text-ink-black
            [@media(hover:hover)_and_(pointer:fine)]:hover:bg-leaf-wash/60
          "
        >
          <svg
            aria-hidden
            className="h-3.25 w-3.25"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.25}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d={l.icon} />
          </svg>
          {l.label}
        </Link>
      ))}
    </nav>
  )
}
