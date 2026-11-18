import { STRINGS, DAYS, MONTHS, type StringKey } from './strings'
import type { Disruption } from './disruptions'
import type { Lang } from './i18n'

/**
 * Every sentence on a disruption record is assembled here from ledger fields -
 * the page, the WhatsApp/X preview image and the share text all call this, so
 * the numbers can never disagree between them. Nothing is free-typed: no
 * minutes or times come from the URL.
 */

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')
}

function hhmm(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' })
}

/** "Rabu, 18 Nov 2026" / "Wed, 18 Nov 2026" in MYT. */
function longDate(iso: string, lang: Lang): string {
  const myt = new Date(Date.parse(iso) + 8 * 3600_000)
  return `${DAYS[lang][myt.getUTCDay()]}, ${myt.getUTCDate()} ${MONTHS[lang][myt.getUTCMonth()]} ${myt.getUTCFullYear()}`
}

export interface DisruptionCopy {
  title: string        // "Rekod Gangguan Perkhidmatan"
  network: string      // "KTM Komuter / ETS"
  route: string | null // "U6201"
  /** The stalled vehicle's label ("EMU 12"), for stalls only. */
  vehicle: string | null
  headline: string     // "Tiada kenderaan dilaporkan"
  date: string         // "Rabu, 18 Nov 2026"
  start: string        // "13:58"
  end: string          // "14:09" | "masih berlaku"
  ongoing: boolean
  minutes: number
  explain: string
  scope: string
  /** One line for the card itself - on the image and the ticket, not just the page. */
  scopeShort: string
  source: string
  /** Pre-filled share message (the link is appended by the share sheet). */
  shareText: string
  /** <title> / og:title - what the chat preview shows in bold. */
  metaTitle: string
  /** og:description - the line under it. */
  metaDescription: string
}

export function disruptionCopy(d: Disruption, lang: Lang): DisruptionCopy {
  const s = STRINGS[lang]
  const headline = s[`alasan.headline.${d.type}` as StringKey]
  const start = hhmm(d.startedAt)
  const ongoing = d.endedAt === null
  const end = ongoing ? s['alasan.ongoing'] : hhmm(d.endedAt!)
  const date = longDate(d.startedAt, lang)
  const route = d.routeId
  const vars = {
    network: d.networkLabel,
    route: route ? ` ${lang === 'ms' ? 'laluan' : 'route'} ${route}` : '',
    headline: headline.toLowerCase(),
    start,
    end,
    minutes: String(d.minutes),
    date,
  }

  return {
    title: s['alasan.title'],
    network: d.networkLabel,
    route,
    vehicle: d.type === 'stall' ? d.vehicleLabel : null,
    headline,
    date,
    start,
    end,
    ongoing,
    minutes: d.minutes,
    explain: fill(s[`alasan.explain.${d.type}` as StringKey], vars),
    scope: s['alasan.scope'],
    scopeShort: s['alasan.scopeShort'],
    source: s['alasan.source'],
    shareText: fill(s['alasan.shareText'], vars),
    metaTitle: `${d.networkLabel}: ${headline} · ${d.minutes} min${ongoing ? ` (${s['alasan.ongoing']})` : ''}`,
    metaDescription: `${date} · ${start}–${end} MYT. ${s['alasan.scopeShort']} ${s['alasan.source']}.`,
  }
}
