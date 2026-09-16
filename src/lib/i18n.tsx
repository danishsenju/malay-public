'use client'

/**
 * TransitMY language layer - BM (default) / EN.
 *
 * A localStorage-backed module store read through useSyncExternalStore, the
 * same pattern as useSavedStops: no provider, no setState-in-effect, and the
 * server always renders BM (the brand default) before the client snapshot
 * takes over on hydration.
 */

import { useCallback, useSyncExternalStore } from 'react'
import { STRINGS, type StringKey } from './strings'

export type Lang = 'ms' | 'en'

const STORAGE_KEY = 'transitmy:lang'
const listeners = new Set<() => void>()

function readLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'en' ? 'en' : 'ms'
  } catch {
    return 'ms'
  }
}

function getServerLang(): Lang {
  return 'ms'
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function setLang(lang: Lang) {
  try { localStorage.setItem(STORAGE_KEY, lang) } catch {}
  // Mirror into a cookie so server-rendered pages (/ktmb, /report, /status)
  // can render in the chosen language too - localStorage never reaches them.
  document.cookie = `transitmy-lang=${lang}; path=/; max-age=31536000; samesite=lax`
  document.documentElement.lang = lang
  listeners.forEach(l => l())
}

export function useLang() {
  const lang = useSyncExternalStore(subscribe, readLang, getServerLang)
  const t = useCallback((key: StringKey) => STRINGS[lang][key], [lang])
  return { lang, setLang, t }
}

/** Compact BM|EN switch - a plate pill with the active language stamped lime. */
export function LangToggle({ className = '' }: { className?: string }) {
  const { lang } = useLang()
  return (
    <div
      role="group"
      aria-label="Bahasa / Language"
      className={`plate flex items-center overflow-hidden rounded-full-2 ${className}`}
    >
      {(['ms', 'en'] as const).map(l => {
        const active = lang === l
        return (
          <button
            key={l}
            type="button"
            aria-pressed={active}
            onClick={() => setLang(l)}
            className="px-8 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] active:scale-[0.94]"
            style={{
              backgroundColor: active ? 'var(--color-lime-spark)' : 'transparent',
              color: active ? 'var(--color-ink-black)' : 'var(--color-sage-mute)',
              transition: 'background-color 150ms var(--ease-out), color 150ms var(--ease-out), transform 120ms var(--ease-out)',
            }}
          >
            {l === 'ms' ? 'BM' : 'EN'}
          </button>
        )
      })}
    </div>
  )
}
