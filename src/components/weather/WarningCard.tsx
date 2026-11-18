'use client'

import { useMemo, useState } from 'react'
import { DAYS, MONTHS, type StringKey } from '@/lib/strings'
import { STATE_BY_CODE, type MetWarning, type StateCode } from '@/lib/flood'
import { parseWarning, stateOfArea, type WarningArea, type WarningItem } from '@/lib/metWarning'
import type { Lang } from '@/lib/i18n'

/**
 * One MET warning, laid out so it can be scanned.
 *
 * MET sends a single run-on paragraph. lib/metWarning.ts rebuilds its structure
 * and this renders it: what is expected, until when, then WHERE as a table
 * (state | districts) with the rider's own state pinned to the top. If the text
 * ever stops fitting the known shapes, the original paragraph is shown instead
 * - and the original is always one tap away, so nothing MET wrote is hidden.
 *
 * Expanding/collapsing is instant: it's reading, not a transition moment.
 */

const VISIBLE_ROWS = 6

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })
}

function shortDateTime(iso: string, lang: Lang): string {
  const myt = new Date(Date.parse(iso) + 8 * 3600_000)
  return `${DAYS[lang][myt.getUTCDay()]} ${myt.getUTCDate()} ${MONTHS[lang][myt.getUTCMonth()]} ${hhmm(iso)}`
}

const areaState = (a: WarningArea): StateCode | null => stateOfArea(a.name)

function AreasTable({
  item, myState, t,
}: { item: WarningItem; myState: StateCode | null; t: (k: StringKey) => string }) {
  const [all, setAll] = useState(false)
  const tabular = item.areaKind === 'states'

  // Own state first, everything else in MET's order.
  const ordered = useMemo(() => {
    const mine = item.areas.filter(a => myState && areaState(a) === myState)
    const rest = item.areas.filter(a => !(myState && areaState(a) === myState))
    return [...mine, ...rest]
  }, [item.areas, myState])
  const shown = all ? ordered : ordered.slice(0, VISIBLE_ROWS)
  const hidden = ordered.length - shown.length

  const heading = (
    <p className="mt-14 flex items-center justify-between font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-sage-mute">
      <span>{t(item.areaKind === 'waters' ? 'wx.warn.waters' : 'wx.warn.states')}</span>
      <span className="tabular-nums">{item.areas.length}</span>
    </p>
  )

  if (!tabular) {
    // Sea areas have no districts - a wrap of tags reads better than a table.
    return (
      <>
        {heading}
        <ul className="mt-8 flex flex-wrap gap-1.5">
          {shown.map(a => (
            <li key={a.name} className="rounded-full-2 border-2 border-ink-black bg-white-plate px-10 py-0.75 font-sans text-caption font-semibold text-ink-black">
              {a.name}
            </li>
          ))}
          {hidden > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setAll(true)}
                className="rounded-full-2 border-2 border-ink-black bg-lime-spark px-10 py-0.75 font-sans text-caption font-bold text-ink-black active:scale-[0.96]"
                style={{ transition: 'transform 120ms var(--ease-out)' }}
              >
                +{hidden}
              </button>
            </li>
          )}
        </ul>
      </>
    )
  }

  return (
    <>
      {heading}
      <ul className="mt-8 overflow-hidden rounded-2xl border-2 border-ink-black bg-white-plate">
        {shown.map((a, i) => {
          const mine = !!myState && areaState(a) === myState
          return (
            <li
              key={a.name}
              className={`grid grid-cols-[104px_1fr] gap-10 px-14 py-8 ${i > 0 ? 'border-t-2 border-dashed border-ink-black/15' : ''} ${mine ? 'bg-lime-spark' : ''}`}
            >
              <span className="font-sans text-caption font-extrabold leading-snug text-ink-black">
                {a.name}
                {mine && (
                  <span className="ml-1.5 rounded-full-2 border-2 border-ink-black bg-white-plate px-1.5 py-px align-middle font-mono text-[9px] font-bold uppercase text-ink-black">
                    {t('wx.warn.you')}
                  </span>
                )}
              </span>
              <span className={`font-sans text-caption leading-snug ${a.detail ? 'text-midnight-ink' : 'text-sage-mute'}`}>
                {a.detail ?? t('wx.warn.whole')}
              </span>
            </li>
          )
        })}
      </ul>
      {ordered.length > VISIBLE_ROWS && (
        <button
          type="button"
          onClick={() => setAll(v => !v)}
          className="pressable-sm mt-8 w-full rounded-full-2 border-2 border-ink-black bg-white-plate py-8 font-sans text-caption font-bold text-ink-black"
        >
          {all ? t('wx.showLess') : `${t('wx.showAll')} (${ordered.length})`}
        </button>
      )}
    </>
  )
}

function Item({ item, myState, t }: { item: WarningItem; myState: StateCode | null; t: (k: StringKey) => string }) {
  const included = !!myState && item.areaKind === 'states' && item.areas.some(a => areaState(a) === myState)
  const excluded = !!myState && item.areaKind === 'states' && !included
  const stateName = myState ? STATE_BY_CODE.get(myState)?.name ?? '' : ''

  return (
    <div className="mt-14">
      {item.title && (
        <span className="inline-block rounded-lg border-2 border-ink-black bg-linen-canvas px-8 py-0.75 font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-ink-black">
          {item.title}
        </span>
      )}
      {item.hazard && (
        <p className="mt-8 font-sans text-body-sm font-extrabold leading-snug tracking-[-0.01em] text-ink-black">
          {item.hazard}
        </p>
      )}
      {item.until && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-8 gap-y-1 font-mono text-[11px] font-bold tabular-nums text-ink-black">
          <span className="rounded-full-2 border-2 border-ink-black bg-mustard-pop px-8 py-0.75 uppercase tracking-[0.06em]">
            {t(item.until.kind === 'range' ? 'wx.warn.range' : 'wx.warn.until')}
          </span>
          {item.until.text}
        </p>
      )}

      {/* Is MY state in this warning? Answered in words, before the table. */}
      {included && (
        <p className="mt-10 font-sans text-caption font-bold text-ink-black">
          {t('wx.warn.included').replace('{state}', stateName)}
        </p>
      )}
      {excluded && (
        <p className="mt-10 font-sans text-caption text-sage-mute">
          {t('wx.warn.excluded').replace('{state}', stateName)}
        </p>
      )}

      <AreasTable item={item} myState={myState} t={t} />

      {item.note && (
        <p className="mt-10 font-sans text-caption leading-relaxed text-sage-mute">{item.note}</p>
      )}
    </div>
  )
}

export function WarningCard({
  w, lang, t, index, myState,
}: { w: MetWarning; lang: Lang; t: (k: StringKey) => string; index: number; myState: StateCode | null }) {
  const [rawOpen, setRawOpen] = useState(false)
  const title = (lang === 'en' ? w.titleEn : w.titleMs) || w.titleMs
  const text = (lang === 'en' ? w.textEn : w.textMs) || w.textMs
  const sections = useMemo(() => parseWarning(text), [text])

  return (
    <li style={{ animation: `cardEnter 250ms var(--ease-out) ${index * 50}ms both` }}>
      <div className="plate shadow-plate-sm rounded-2xl p-16">
        <div className="flex items-start gap-10">
          <span className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg border-2 border-ink-black bg-mustard-pop text-ink-black">
            <svg aria-hidden className="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3.5L2.5 20h19L12 3.5zM12 10v4.5M12 17.5v.01" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-sans text-body-sm font-extrabold leading-snug text-ink-black">{title}</p>
            <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.06em] text-sage-mute tabular-nums">
              {t('wx.warnings.issued')} {shortDateTime(w.issued, lang)}
              {w.validTo && <> · {t('wx.warnings.until')} {shortDateTime(w.validTo, lang)}</>}
            </p>
          </div>
        </div>

        {sections ? (
          <>
            {sections.map((s, si) => (
              <div key={si} className={si > 0 ? 'mt-18 border-t-2 border-dashed border-ink-black/15' : ''}>
                {s.heading && (
                  <p className="mt-14 font-mono text-[10px] font-bold uppercase leading-snug tracking-[0.1em] text-sage-mute">
                    {s.heading}
                  </p>
                )}
                {s.items.map((item, ii) => (
                  <Item key={ii} item={item} myState={myState} t={t} />
                ))}
              </div>
            ))}
            {/* Transparency: MET's own words, untouched, one tap away. */}
            <button
              type="button"
              onClick={() => setRawOpen(o => !o)}
              className="mt-14 font-sans text-caption font-bold text-cobalt-band underline underline-offset-2"
            >
              {rawOpen ? t('wx.warn.hideOriginal') : t('wx.warn.original')}
            </button>
            {rawOpen && (
              <p className="mt-8 whitespace-pre-line rounded-2xl border-2 border-ink-black/15 bg-linen-canvas p-14 font-sans text-caption leading-relaxed text-midnight-ink">
                {text}
              </p>
            )}
          </>
        ) : (
          text && (
            // Unrecognised shape: show MET's text exactly as sent.
            <>
              <p className={`mt-10 whitespace-pre-line font-sans text-caption leading-relaxed text-midnight-ink ${rawOpen ? '' : 'line-clamp-3'}`}>
                {text}
              </p>
              <button
                type="button"
                onClick={() => setRawOpen(o => !o)}
                className="mt-8 font-sans text-caption font-bold text-cobalt-band underline underline-offset-2"
              >
                {rawOpen ? t('wx.readLess') : t('wx.readMore')}
              </button>
            </>
          )
        )}
      </div>
    </li>
  )
}
