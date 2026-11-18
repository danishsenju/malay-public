import type { Lang } from '@/lib/i18n'

/**
 * MET publishes forecasts in BM only, from a small fixed vocabulary
 * ("Ribut petir di beberapa tempat di kawasan pedalaman"). EN is composed
 * from the parts; anything unrecognised falls back to MET's own words rather
 * than a guess.
 */
const PHRASES: [RegExp, string][] = [
  [/^tiada hujan/i, 'No rain'],
  [/^ribut petir di kebanyakan tempat/i, 'Widespread thunderstorms'],
  [/^ribut petir di beberapa tempat/i, 'Scattered thunderstorms'],
  [/^ribut petir di satu dua tempat/i, 'Isolated thunderstorms'],
  [/^ribut petir/i, 'Thunderstorms'],
  [/^hujan menyeluruh/i, 'Rain throughout'],
  [/^hujan di kebanyakan tempat/i, 'Widespread rain'],
  [/^hujan di beberapa tempat/i, 'Scattered rain'],
  [/^hujan di satu dua tempat/i, 'Isolated rain'],
  [/^hujan/i, 'Rain'],
  [/^berjerebu/i, 'Hazy'],
  [/^berangin/i, 'Windy'],
  [/^cerah/i, 'Fair'],
]

const PLACES: [RegExp, string][] = [
  [/di kawasan pedalaman/i, 'inland'],
  [/di kawasan pantai/i, 'on the coast'],
]

export function forecastText(bm: string, lang: Lang): string {
  if (lang === 'ms' || !bm) return bm
  const head = PHRASES.find(([re]) => re.test(bm.trim()))
  if (!head) return bm
  const place = PLACES.find(([re]) => re.test(bm))
  return place ? `${head[1]} ${place[1]}` : head[1]
}

const WHEN_EN: Record<string, string> = { Pagi: 'morning', Petang: 'afternoon', Malam: 'night' }
export function whenText(when: string | null, lang: Lang): string | null {
  if (!when) return null
  return lang === 'en' ? WHEN_EN[when] ?? when : when.toLowerCase()
}

type Kind = 'storm' | 'rain' | 'haze' | 'fair'

function kindOf(bm: string): Kind {
  if (/ribut petir/i.test(bm)) return 'storm'
  if (/^tiada hujan/i.test(bm)) return 'fair'
  if (/hujan/i.test(bm)) return 'rain'
  if (/jerebu/i.test(bm)) return 'haze'
  return 'fair'
}

const CLOUD = 'M17.5 14.5H7a4 4 0 1 1 .9-7.9 5.5 5.5 0 0 1 10.5 1.4 3.25 3.25 0 0 1-.9 6.5z'
const GLYPH: Record<Kind, string> = {
  storm: `${CLOUD}M12.5 16.5l-2 3.25h3l-2 3.25`,
  rain: `${CLOUD}M8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5`,
  haze: 'M4 9h16M6 13h12M4 17h16M8 5h8',
  fair: 'M12 7.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
}

/** Monoline weather glyph (DESIGN.md: 2px ink stroke, no fills). */
export function WeatherGlyph({ summary, className = 'h-20 w-20' }: { summary: string; className?: string }) {
  return (
    <svg aria-hidden className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={GLYPH[kindOf(summary)]} />
    </svg>
  )
}
