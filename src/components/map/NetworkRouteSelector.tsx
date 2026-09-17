'use client'

import { useMemo, useState } from 'react'
import type { RouteSummary } from '@/lib/map'
import { normalizeHex } from '@/lib/map'
import { useLang } from '@/lib/i18n'

export type MapNetwork = 'ktmb' | 'rapid-bus-kl' | 'mybas-johor'

interface Props {
  network: MapNetwork
  onNetworkChange: (n: MapNetwork) => void
  routes: RouteSummary[] | undefined
  routesLoading: boolean
  selectedRoute: RouteSummary | null
  onSelectRoute: (r: RouteSummary | null) => void
}

const TABS: { id: MapNetwork; label: string }[] = [
  { id: 'ktmb', label: 'KTM' },
  { id: 'rapid-bus-kl', label: 'Rapid KL Bus' },
  { id: 'mybas-johor', label: 'myBAS Johor' },
]

function routeText(r: RouteSummary): string {
  return `${r.route_short_name ?? r.route_id} ${r.route_long_name ?? ''} ${r.route_id}`.toLowerCase()
}

export function NetworkRouteSelector({
  network,
  onNetworkChange,
  routes,
  routesLoading,
  selectedRoute,
  onSelectRoute,
}: Props) {
  const { t } = useLang()
  const [query, setQuery] = useState('')
  // Once a route is picked, the whole point is to look at the map - the
  // search input + hundreds-of-routes list would otherwise bury it every
  // time. Collapse to a compact chip and only reopen on explicit request.
  const [searching, setSearching] = useState(true)

  const filtered = useMemo(() => {
    if (!routes) return []
    const q = query.trim().toLowerCase()
    const list = q === '' ? routes : routes.filter(r => routeText(r).includes(q))
    return list.slice(0, 60) // cap the rendered list; the search narrows it
  }, [routes, query])

  function selectRoute(r: RouteSummary) {
    onSelectRoute(r)
    setSearching(false)
  }

  function clearRoute() {
    onSelectRoute(null)
    setSearching(true)
  }

  return (
    <div className="plate shadow-plate w-full max-w-md rounded-2xl p-14">
      {/* Segmented network toggle */}
      <div
        className="flex gap-8"
        role="tablist"
        aria-label={t('map.pickNetwork')}
      >
        {TABS.map(tab => {
          const active = network === tab.id
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => { onNetworkChange(tab.id); setSearching(true) }}
              className={[
                'pressable-gpu flex-1 rounded-lg border-2 border-ink-black px-14 py-8',
                'font-sans text-body-sm font-bold',
                active ? 'bg-lime-spark text-ink-black' : 'bg-white-plate text-ink-black',
              ].join(' ')}
            >
              {tab.label}
            </button>
          )
        })}
      </div>

      {network === 'ktmb' ? (
        <p className="mt-12 font-sans text-caption leading-snug text-sage-mute">
          {t('map.ktmInfo')}
        </p>
      ) : selectedRoute && !searching ? (
        /* Collapsed - a route is picked, so the map (with the route drawn on
           it) is the point. One compact row: chip, name, change, clear. */
        <div className="mt-12 flex items-center gap-8">
          <span
            className="shrink-0 rounded-lg border-2 border-ink-black px-8 py-1 font-mono text-caption font-bold leading-none"
            style={{ backgroundColor: normalizeHex(selectedRoute.route_color), color: '#fff' }}
          >
            {selectedRoute.route_short_name ?? selectedRoute.route_id}
          </span>
          <span className="min-w-0 flex-1 truncate font-sans text-caption text-midnight-ink/80">
            {selectedRoute.route_long_name ?? ''}
          </span>
          <button
            type="button"
            onClick={() => setSearching(true)}
            className="shrink-0 font-sans text-caption font-bold text-cobalt-band underline underline-offset-2"
          >
            {t('map.changeRoute')}
          </button>
          <button
            type="button"
            onClick={clearRoute}
            aria-label={t('map.clearRoute')}
            className="shrink-0 font-sans text-caption font-bold text-sage-mute underline underline-offset-2"
          >
            {t('map.clearRoute')}
          </button>
        </div>
      ) : (
        <div className="mt-12">
          {/* Search input */}
          <input
            type="text"
            inputMode="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('map.searchRoute')}
            className="
              w-full rounded-lg border-2 border-ink-black bg-white-plate px-12 py-8
              font-sans text-body-sm text-ink-black placeholder:text-sage-mute
              focus:outline-none focus-visible:ring-2 focus-visible:ring-cobalt-band
            "
            aria-label={t('map.searchRouteAria')}
            autoFocus={selectedRoute !== null}
          />

          {/* Currently selected route */}
          {selectedRoute && (
            <div className="mt-10 flex items-center gap-8">
              <span
                className="shrink-0 rounded-lg border-2 border-ink-black px-8 py-1 font-mono text-caption font-bold leading-none"
                style={{ backgroundColor: normalizeHex(selectedRoute.route_color), color: '#fff' }}
              >
                {selectedRoute.route_short_name ?? selectedRoute.route_id}
              </span>
              <span className="truncate font-sans text-caption text-midnight-ink/80">
                {selectedRoute.route_long_name ?? ''}
              </span>
              <button
                type="button"
                onClick={clearRoute}
                className="ml-auto shrink-0 font-sans text-caption font-bold text-sage-mute underline underline-offset-2"
              >
                {t('map.clearRoute')}
              </button>
            </div>
          )}

          {/* Route count + scroll cue - the list holds hundreds of routes, so
              say so out loud; the chevron nudges twice to teach the scroll. */}
          {!routesLoading && filtered.length > 1 && (
            <p className="mt-10 flex items-center gap-4 font-mono text-[10px] font-bold uppercase tracking-widest text-sage-mute">
              {filtered.length}{query.trim() === '' && routes && routes.length > filtered.length ? `/${routes.length}` : ''} {t('map.routes')}
              {filtered.length > 6 && (
                <>
                  <span className="normal-case tracking-normal">· {t('map.scrollMore')}</span>
                  <svg
                    aria-hidden
                    className="h-3 w-3"
                    style={{ animation: 'scrollNudge 900ms var(--ease-in-out) 600ms 3' }}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </>
              )}
            </p>
          )}

          {/* Route list - max-height chosen to cut the last visible row in
              half: the strongest "there's more below" affordance there is. */}
          <div className="scrollbar-none mt-8 max-h-66 overflow-y-auto overscroll-contain">
            {routesLoading ? (
              <p className="py-14 text-center font-sans text-caption text-sage-mute">
                {t('map.loadingRoutes')}
              </p>
            ) : filtered.length === 0 ? (
              <p className="py-14 text-center font-sans text-caption text-sage-mute">
                {t('map.noMatchingRoutes')}
              </p>
            ) : (
              <ul className="flex flex-col gap-6">
                {filtered.map(r => {
                  const active = selectedRoute?.route_id === r.route_id
                  return (
                    <li key={r.route_id}>
                      <button
                        type="button"
                        onClick={() => selectRoute(r)}
                        className={[
                          'flex w-full items-center gap-8 rounded-lg border-2 px-10 py-8 text-left',
                          'transition-colors duration-150 ease-out',
                          active
                            ? 'border-ink-black bg-leaf-wash'
                            : 'border-ink-black/15 bg-white-plate [@media(hover:hover)_and_(pointer:fine)]:hover:border-ink-black/40',
                        ].join(' ')}
                      >
                        <span
                          className="shrink-0 rounded border-2 border-ink-black px-6 py-0.5 font-mono text-[11px] font-bold leading-none"
                          style={{ backgroundColor: normalizeHex(r.route_color), color: '#fff' }}
                        >
                          {r.route_short_name ?? r.route_id}
                        </span>
                        <span className="truncate font-sans text-caption text-midnight-ink/80">
                          {r.route_long_name ?? r.route_id}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
