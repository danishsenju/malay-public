import { STRINGS, type StringKey } from './strings'
import { LEVEL_RANK, STATE_BY_CODE, isElevated, type FloodStation, type StateCode } from './flood'
import type { Lang } from './i18n'

/**
 * Everything a shared flood message says is built here from JPS station data -
 * the WhatsApp text, the link preview image and the page title all call these,
 * so their numbers can never disagree. Pure and client-safe (no browser or
 * server APIs), so the Cuaca page, the OG image route and generateMetadata
 * share one implementation.
 */

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
}

export function hhmmMyt(iso: string | null | undefined): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' });
}

/** How far past its threshold a river is - orders rivers within one level. */
function margin(s: FloodStation): number {
  return s.waterLevelM != null && s.thresholdM != null ? s.waterLevelM - s.thresholdM : 0;
}

export interface ScopeSummary {
  /** "Kelantan" or "Malaysia" */
  scopeName: string;
  danger: number;
  warning: number;
  alert: number;
  /** The three worst rivers in scope, worst first. */
  top: FloodStation[];
  updatedAt: string | null;
}

export function summarizeFlood(stations: FloodStation[], state: StateCode | null, updatedAt: string | null): ScopeSummary {
  const scoped = state ? stations.filter(s => s.state === state) : stations;
  const elevated = scoped
    .filter(s => isElevated(s.level))
    .sort((a, b) => LEVEL_RANK[b.level!] - LEVEL_RANK[a.level!] || margin(b) - margin(a));
  const count = (l: 'danger' | 'warning' | 'alert') => elevated.filter(s => s.level === l).length;
  return {
    scopeName: state ? STATE_BY_CODE.get(state)?.name ?? state : 'Malaysia',
    danger: count('danger'),
    warning: count('warning'),
    alert: count('alert'),
    top: elevated.slice(0, 3),
    updatedAt,
  };
}

/** Path of the preview card for this view (/api/og/banjir) - same params as the link. */
export function floodShareImagePath(p: { state?: StateCode | null; station?: string | null; lang: Lang }): string {
  const q = new URLSearchParams();
  if (p.station) q.set('station', p.station);
  else if (p.state) q.set('state', p.state);
  q.set('lang', p.lang);
  return `/api/og/banjir?${q.toString()}`;
}

/** "banjir-sg-tangkak-di-kg-seri-maamor" - a safe file name for "Save image". */
export function shareSlug(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'banjir';
}

/** "/weather?tab=banjir&state=KEL" - deep link that reopens the same view. */
export function floodShareUrl(
  origin: string,
  p: { state?: StateCode | null; station?: string | null; lang: Lang },
): string {
  const q = new URLSearchParams({ tab: 'banjir' });
  if (p.station) q.set('station', p.station);
  else if (p.state) q.set('state', p.state);
  q.set('lang', p.lang);
  return `${origin}/weather?${q.toString()}`;
}

const TREND_ARROW = { rising: '↑', falling: '↓', steady: '→' } as const;

/** Short title for share sheets / email subjects: "Paras sungai Selangor". */
export function scopeShareTitle(sum: ScopeSummary, lang: Lang): string {
  return `${STRINGS[lang]['og.flood.eyebrow']} ${sum.scopeName}`;
}

/**
 * The message for a state / nationwide view. It ENDS with the "live link:" label
 * but not the link itself: the OS share sheet appends `url` on its own, and
 * pasting both would print the link twice. Channels that take one string
 * (wa.me, mailto) join text + "\n" + url themselves.
 */
export function scopeShareText(sum: ScopeSummary, lang: Lang): string {
  const s = STRINGS[lang];
  const time = hhmmMyt(sum.updatedAt);
  if (sum.danger + sum.warning + sum.alert === 0) {
    return `${fill(s['share.flood.calm'], { scope: sum.scopeName, time })}\n${s['share.flood.live']}`;
  }
  const counts = (['danger', 'warning', 'alert'] as const)
    .filter(l => sum[l] > 0)
    .map(l => `${sum[l]} ${s[`wx.level.${l}` as StringKey]}`)
    .join(' · ');
  const top = sum.top[0];
  const lines = [
    fill(s['share.flood.head'], { scope: sum.scopeName, time }),
    counts,
  ];
  if (top && top.waterLevelM != null) {
    lines.push(fill(s['share.flood.top'], {
      name: top.name,
      level: top.waterLevelM.toFixed(2),
      threshold: top.thresholdM != null ? top.thresholdM.toFixed(2) : '-',
    }));
  }
  lines.push(s['share.flood.live']);
  return lines.join('\n');
}

/** The message for one river station (same link convention as scopeShareText). */
export function stationShareText(st: FloodStation, lang: Lang): string {
  const s = STRINGS[lang];
  const place = [st.district, STATE_BY_CODE.get(st.state)?.name].filter(Boolean).join(', ');
  const level = st.level ? s[`wx.level.${st.level}` as StringKey] : '';
  const trend = st.trend ? ` ${TREND_ARROW[st.trend]} ${s[`wx.trend.${st.trend}` as StringKey]}` : '';
  const reading = st.waterLevelM != null
    ? fill(s['share.station.line'], {
        level,
        water: st.waterLevelM.toFixed(2),
        threshold: st.thresholdM != null ? st.thresholdM.toFixed(2) : '-',
        trend,
        time: hhmmMyt(st.levelAt),
      })
    : '';
  return [
    fill(s['share.station.head'], { name: st.name, place }),
    reading,
    s['share.flood.live'],
  ].filter(Boolean).join('\n');
}
