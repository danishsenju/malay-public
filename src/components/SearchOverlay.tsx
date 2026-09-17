'use client'

import { useEffect, useRef, useState } from 'react'
import { useLang } from '@/lib/i18n'
import type { StringKey } from '@/lib/strings'
import type { NearbyStop, Network } from '@/lib/types'
import { getRailLine } from '@/lib/transit'

function StopNameText({ name }: { name: string }) {
  const match = name.match(/^(.+?)\s*(?:ke\s+arah|→|->)\s*(.+)$/i)
  if (!match) return <>{name}</>
  return (
    <>
      {match[1]}
      <span className="mx-1.5 font-normal text-sage-mute/60">→</span>
      {match[2]}
    </>
  )
}

// ── Network metadata ───────────────────────────────────────────────────────────

type Filter = 'all' | Network

interface FilterDef {
  id:         Filter
  label:      StringKey
  activeBg:   string
  activeText: string
}

const FILTER_DEFS: FilterDef[] = [
  { id: 'all',                    label: 'search.filter.all',      activeBg: 'var(--color-ink-black)',     activeText: '#ffffff' },
  { id: 'rapid-bus-kl',           label: 'search.filter.bus',      activeBg: 'var(--color-cobalt-band)',   activeText: '#ffffff' },
  { id: 'rapid-rail-kl',          label: 'search.filter.rail',     activeBg: 'var(--color-lavender-mist)', activeText: 'var(--color-ink-black)' },
  { id: 'ktmb',                   label: 'search.filter.ktm',      activeBg: 'var(--color-mustard-pop)',   activeText: 'var(--color-ink-black)' },
  { id: 'mybas-johor',            label: 'search.filter.johor',    activeBg: 'var(--color-maroon-plate)',  activeText: '#ffffff' },
  { id: 'rapid-bus-penang',       label: 'search.filter.penang',   activeBg: 'var(--color-cobalt-deep)',   activeText: '#ffffff' },
  { id: 'rapid-bus-mrtfeeder',    label: 'search.filter.mrtfeeder',activeBg: 'var(--color-forest-ink)',    activeText: '#ffffff' },
  { id: 'mybas-alor-setar',       label: 'search.filter.alorSetar',activeBg: 'var(--color-charcoal-pill)', activeText: '#ffffff' },
  { id: 'mybas-kuala-terengganu', label: 'search.filter.kt',       activeBg: 'var(--color-concrete-tile)', activeText: 'var(--color-ink-black)' },
  { id: 'mybas-ipoh',             label: 'search.filter.ipoh',     activeBg: 'var(--color-cobalt-deep)',   activeText: '#ffffff' },
  { id: 'mybas-seremban-a',       label: 'search.filter.serembanA',activeBg: 'var(--color-forest-ink)',    activeText: '#ffffff' },
  { id: 'mybas-seremban-b',       label: 'search.filter.serembanB',activeBg: 'var(--color-charcoal-pill)', activeText: '#ffffff' },
  { id: 'mybas-melaka',           label: 'search.filter.melaka',   activeBg: 'var(--color-concrete-tile)', activeText: 'var(--color-ink-black)' },
  { id: 'mybas-kuching',          label: 'search.filter.kuching',  activeBg: 'var(--color-cobalt-deep)',   activeText: '#ffffff' },
]

const NETWORK_ACCENT: Record<Network, string> = {
  'rapid-bus-kl':           'var(--color-cobalt-band)',
  'rapid-rail-kl':          'var(--color-lavender-mist)',
  'ktmb':                   'var(--color-mustard-pop)',
  'mybas-johor':            'var(--color-maroon-plate)',
  'rapid-bus-penang':       'var(--color-cobalt-deep)',
  'rapid-bus-mrtfeeder':    'var(--color-forest-ink)',
  'mybas-alor-setar':       'var(--color-charcoal-pill)',
  'mybas-kuala-terengganu': 'var(--color-concrete-tile)',
  'mybas-ipoh':             'var(--color-cobalt-deep)',
  'mybas-seremban-a':       'var(--color-forest-ink)',
  'mybas-seremban-b':       'var(--color-charcoal-pill)',
  'mybas-melaka':           'var(--color-concrete-tile)',
  'mybas-kuching':          'var(--color-cobalt-deep)',
}

const NETWORK_LABEL: Record<Network, string> = {
  'rapid-bus-kl':           'RapidKL Bus',
  'rapid-rail-kl':          'Rapid Rail',
  'ktmb':                   'KTM',
  'mybas-johor':            'myBAS Johor',
  'rapid-bus-penang':       'Rapid Penang',
  'rapid-bus-mrtfeeder':    'MRT Feeder Bus',
  'mybas-alor-setar':       'myBAS Alor Setar',
  'mybas-kuala-terengganu': 'myBAS K. Terengganu',
  'mybas-ipoh':             'myBAS Ipoh',
  'mybas-seremban-a':       'myBAS Seremban A',
  'mybas-seremban-b':       'myBAS Seremban B',
  'mybas-melaka':           'myBAS Melaka',
  'mybas-kuching':          'myBAS Kuching',
}

// ── Component ─────────────────────────────────────────────────────────────────

interface SearchOverlayProps {
  isOpen:   boolean
  onClose:  () => void
  onSelect: (stop: NearbyStop) => void
}

export function SearchOverlay({ isOpen, onClose, onSelect }: SearchOverlayProps) {
  // The panel holds all search state, so closing unmounts it and reopening
  // starts fresh - no reset-state-in-effect needed.
  if (!isOpen) return null
  return <SearchPanel onClose={onClose} onSelect={onSelect} />
}

function SearchPanel({ onClose, onSelect }: Omit<SearchOverlayProps, 'isOpen'>) {
  const { t } = useLang()
  const [query,      setQuery]      = useState('')
  const [filter,     setFilter]     = useState<Filter>('all')
  const [results,    setResults]    = useState<NearbyStop[]>([])
  const [isFetching, setIsFetching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Focus the input once mounted (after the enter animation starts)
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 100)
    return () => clearTimeout(t)
  }, [])

  // Keyboard escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function doSearch(q: string, net: Filter) {
    if (q.trim().length < 2) { setResults([]); return }
    setIsFetching(true)
    try {
      const params = new URLSearchParams({ q: q.trim() })
      if (net !== 'all') params.set('network', net)
      const res  = await fetch(`/api/stops/search?${params}`)
      const data = (await res.json()) as NearbyStop[]
      setResults(Array.isArray(data) ? data : [])
    } catch {
      // Silent degrade - blank result list is safe
    } finally {
      setIsFetching(false)
    }
  }

  function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setQuery(val)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(val, filter), 250)
  }

  function handleFilterChange(net: Filter) {
    setFilter(net)
    if (query.trim().length >= 2) doSearch(query, net)
  }

  function handleSelect(stop: NearbyStop) {
    onClose()
    onSelect(stop)
  }

  const hasQuery   = query.trim().length >= 2
  const hasResults = results.length > 0

  return (
    // Backdrop - full linen on mobile, dark overlay on desktop.
    // Click outside the panel (desktop) to close.
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('search.aria')}
      className="fixed inset-0 z-50 flex flex-col bg-linen-canvas md:items-center md:justify-center md:bg-ink-black/60 md:backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Panel - full-screen on mobile, centered modal on desktop */}
      <div
        className="flex h-full w-full flex-col bg-linen-canvas md:h-auto md:max-h-[80dvh] md:max-w-140 md:overflow-hidden md:rounded-3xl-2 md:border-2 md:border-ink-black"
        style={{ animation: 'searchIn 180ms var(--ease-out) both' }}
        onClick={e => e.stopPropagation()}
      >

        {/* ── Top bar: back + input ──────────────────────────────────────── */}
        <div className="flex w-full shrink-0 items-center gap-8 px-16 py-14">

          {/* Back chevron - bordered disc */}
          <button
            type="button"
            aria-label={t('search.close')}
            onClick={onClose}
            className="plate flex h-40 w-40 shrink-0 items-center justify-center rounded-full-3 text-ink-black active:scale-90"
            style={{ transition: 'transform 160ms var(--ease-out)' }}
          >
            <svg aria-hidden className="h-18 w-18" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          {/* Search input - a full pill plate */}
          <div className="relative flex-1">
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={handleQueryChange}
              placeholder={t('search.placeholder')}
              autoComplete="off"
              spellCheck={false}
              className="
                plate w-full rounded-full-2 py-10 pl-18 pr-40
                font-sans text-[15px] font-medium text-ink-black placeholder:text-sage-mute/70
                focus:outline-none focus:ring-2 focus:ring-cobalt-band focus:ring-offset-2 focus:ring-offset-linen-canvas
              "
            />

            {/* Spinner */}
            {isFetching && (
              <div
                aria-label={t('search.searching')}
                className="
                  pointer-events-none absolute right-14 top-1/2 -translate-y-1/2
                  h-14 w-14 rounded-full-3 border-2 border-ink-black/15 border-t-ink-black animate-spin
                "
              />
            )}

            {/* Clear button */}
            {query.length > 0 && !isFetching && (
              <button
                type="button"
                aria-label={t('search.clear')}
                onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus() }}
                className="
                  absolute right-14 top-1/2 -translate-y-1/2
                  flex h-18 w-18 items-center justify-center rounded-full-3
                  bg-ink-black text-white-plate active:scale-90
                "
                style={{ transition: 'transform 120ms var(--ease-out)' }}
              >
                <svg aria-hidden className="h-8 w-8" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* ── Filter chips ────────────────────────────────────────────────── */}
        <div className="w-full shrink-0 overflow-x-auto border-b-2 border-ink-black px-16 pb-14 scrollbar-none">
          <div className="flex gap-8">
            {FILTER_DEFS.map(f => {
              const active = filter === f.id
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => handleFilterChange(f.id)}
                  className="shrink-0 rounded-full-2 border-2 border-ink-black px-16 py-4 font-mono text-caption font-bold tracking-[0.02em] active:scale-[0.95]"
                  style={{
                    backgroundColor: active ? f.activeBg : 'var(--color-white-plate)',
                    color:           active ? f.activeText : 'var(--color-sage-mute)',
                    transition: 'background-color 150ms var(--ease-out), color 150ms var(--ease-out), transform 140ms var(--ease-out)',
                  }}
                >
                  {t(f.label)}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div className="w-full flex-1 overflow-y-auto overscroll-contain">

          {/* Idle state - no query yet */}
          {!hasQuery && (
            <div className="flex flex-col items-center gap-14 px-40 pt-64 text-center">
              {/* Lime sticker with the magnifier */}
              <span className="plate shadow-plate flex h-64 w-64 items-center justify-center rounded-full-3 bg-lime-spark">
                <svg
                  aria-hidden
                  className="h-24 w-24 text-ink-black"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                >
                  <circle cx="11" cy="11" r="8" />
                  <path strokeLinecap="round" d="m21 21-4.35-4.35" />
                </svg>
              </span>
              <p className="font-sans text-body font-bold text-ink-black">
                {t('search.idle.title')}
              </p>
              <p className="max-w-[260px] font-sans text-[13px] leading-relaxed text-sage-mute">
                {t('search.idle.desc')}
              </p>

              {/* Network guide pills */}
              <div className="mt-8 flex flex-wrap justify-center gap-8">
                {FILTER_DEFS.slice(1).map(f => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => handleFilterChange(f.id)}
                    className="rounded-full-2 border-2 border-ink-black px-14 py-4 font-mono text-[11px] font-bold active:scale-[0.95]"
                    style={{
                      backgroundColor: f.activeBg,
                      color: f.activeText,
                      transition: 'transform 140ms var(--ease-out)',
                    }}
                  >
                    {t(f.label)}
                  </button>
                ))}
              </div>
              <p className="font-sans text-caption text-sage-mute/80">
                {t('search.idle.hint')}
              </p>
            </div>
          )}

          {/* No results */}
          {hasQuery && !isFetching && !hasResults && (
            <div className="flex flex-col items-center gap-8 px-40 pt-64 text-center">
              <p className="font-sans text-body font-bold text-ink-black">
                {t('search.noMatch')} &ldquo;{query}&rdquo;
              </p>
              {filter !== 'all' && (
                <button
                  type="button"
                  onClick={() => handleFilterChange('all')}
                  className="mt-4 rounded-full-2 border-2 border-ink-black bg-lime-spark px-16 py-4 font-sans text-[13px] font-bold text-ink-black active:scale-[0.96]"
                  style={{ transition: 'transform 140ms var(--ease-out)' }}
                >
                  {t('search.allNetworks')}
                </button>
              )}
            </div>
          )}

          {/* Result list - each hit is a plate */}
          {hasResults && (
            <ul role="listbox" className="space-y-10 px-16 py-16">
              {results.map((stop, i) => {
                const accent = NETWORK_ACCENT[stop.network as Network]
                const line   = stop.network === 'rapid-rail-kl'
                  ? getRailLine(stop.stop_id)
                  : null
                return (
                  <li
                    key={`${stop.stop_id}:${stop.network}`}
                    role="option"
                    aria-selected={false}
                    style={{ animation: `cardEnter 200ms var(--ease-out) ${i * 22}ms both` }}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelect(stop)}
                      className="
                        plate pressable-sm flex w-full items-center gap-14 rounded-2xl px-16 py-14 text-left
                        [@media(hover:hover)_and_(pointer:fine)]:hover:bg-leaf-wash/60
                      "
                    >
                      {/* Network / line colour swatch */}
                      <span
                        className="h-14 w-14 shrink-0 rounded-lg border-2 border-ink-black"
                        style={{ backgroundColor: line ? line.color : accent }}
                      />

                      {/* Text content */}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-sans text-[15px] font-bold leading-snug text-ink-black">
                          <StopNameText name={stop.stop_name} />
                        </span>
                        <span className="mt-2 block truncate font-mono text-[11px] font-medium text-sage-mute">
                          {line
                            ? `${line.type} · ${line.name}`
                            : (NETWORK_LABEL[stop.network as Network] ?? stop.network)}
                        </span>
                      </span>

                      {/* Trailing chevron */}
                      <svg
                        aria-hidden
                        className="h-16 w-16 shrink-0 text-ink-black/30"
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="m9 18 6-6-6-6" />
                      </svg>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
