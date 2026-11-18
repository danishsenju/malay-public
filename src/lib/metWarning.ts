import { STATES, type StateCode } from './flood'

/**
 * MET Malaysia publishes each warning as ONE long paragraph, with every state
 * (and its districts) strung together by " • ". This turns that paragraph back
 * into the structure it was written from, so the UI can lay it out as a table
 * a rider can scan. Pure and client-safe; works on both the BM and EN text.
 *
 * Shapes seen in the live feed (2026-11):
 *   land    "<hazard> dijangka di negeri A • B (district, district) • C ... sehingga 6:00 Petang; Rabu, 18 November 2026."
 *   marine  "SEKSYEN A: UNTUK ... [..] 1) TITLE <hazard> dijangka di kawasan perairan X • Y sehingga ... <note> 2) ..."
 *           (EN: "SECTION A: FOR ..." / "are expected over the waters of")
 *   Sarawak/Sabah use "Sarawak: Mukah (Mukah dan Dalat), Samarahan (...)" inside one bullet.
 *
 * parseWarning returns null when the text doesn't fit - the caller then shows
 * MET's own wording untouched. It never invents or drops information.
 */

export interface WarningArea {
  name: string;
  /** Districts / sub-areas, as MET wrote them. null for a bare name. */
  detail: string | null;
}

export interface WarningItem {
  /** "AMARAN RIBUT PETIR" - the numbered item's heading, if it has one. */
  title: string | null;
  /** "Ribut petir, hujan lebat dan angin kencang" */
  hazard: string | null;
  areaKind: 'states' | 'waters' | null;
  areas: WarningArea[];
  until: { kind: 'until' | 'range'; text: string } | null;
  /** MET's consequence sentence ("Keadaan ini boleh menyebabkan ..."). */
  note: string | null;
}

export interface WarningSection {
  /** "UNTUK PERAIRAN MALAYSIA [DALAM LINGKUNGAN 24 BATU NAUTIKA]" */
  heading: string | null;
  items: WarningItem[];
}

const SECTION_RE = /(?:SEKSYEN|SECTION)\s+[A-Z]\s*:\s*/g;
const ITEM_SPLIT_RE = /(?:^|\s)\d+\)\s+/;
// Leading ALL-CAPS run that ends where the sentence case begins.
const TITLE_RE = /^([A-Z][A-Z\s()\-/]+?)\s+(?=[A-Z][a-z])/;
const AREA_MARKER_RE = /\s(?:dijangka di|are expected (?:in|over))\s+(?:negeri|kawasan perairan|the (?:states|waters) of)\s+/i;
const VALIDITY_MARKER_RE = /\s(sehingga|until|dalam tempoh|within the period of)\s+/i;
// "6:00 Petang; Rabu, 18 November 2026" optionally followed by "sehingga Isnin, 23 November 2026", then ". note"
const VALIDITY_BODY_RE = /^([^.]*?\d{4}(?:\s+(?:sehingga|until)\s+[^.]*?\d{4})?)\s*\.?\s*(.*)$/;

function parseArea(raw: string): WarningArea {
  // "Sarawak: Mukah (Mukah dan Dalat), Samarahan (...)"
  const colon = raw.match(/^([^:()]+):\s*(.+)$/);
  if (colon) return { name: colon[1].trim(), detail: colon[2].trim() };
  // "Selangor (Gombak, Petaling, ...)"
  const paren = raw.match(/^([^()]+?)\s*\((.+)\)$/);
  if (paren) return { name: paren[1].trim(), detail: paren[2].trim() };
  return { name: raw.trim(), detail: null };
}

function parseItem(raw: string): WarningItem | null {
  let rest = raw.trim();
  const titleMatch = rest.match(TITLE_RE);
  const title = titleMatch ? titleMatch[1].trim() : null;
  if (titleMatch) rest = rest.slice(titleMatch[0].length);

  const marker = rest.match(AREA_MARKER_RE);
  if (!marker || marker.index === undefined) return null;
  const hazard = rest.slice(0, marker.index).trim() || null;
  const areaKind: WarningItem['areaKind'] = /negeri|states/i.test(marker[0]) ? 'states' : 'waters';
  const after = rest.slice(marker.index + marker[0].length);

  const validity = after.match(VALIDITY_MARKER_RE);
  const areaText = validity && validity.index !== undefined ? after.slice(0, validity.index) : after;
  const areas = areaText.split('•').map(s => s.trim()).filter(Boolean).map(parseArea);
  if (areas.length === 0) return null;

  let until: WarningItem['until'] = null;
  let note: string | null = null;
  if (validity && validity.index !== undefined) {
    const tail = after.slice(validity.index + validity[0].length);
    const body = tail.match(VALIDITY_BODY_RE);
    if (body) {
      const isRange = /^(dalam tempoh|within the period of)$/i.test(validity[1]);
      until = {
        kind: isRange ? 'range' : 'until',
        text: body[1].replace(/\s+(?:sehingga|until)\s+/i, ' – ').replace(/;\s*/, ' · '),
      };
      note = body[2].trim() || null;
    }
  }
  return { title, hazard, areaKind, areas, until, note };
}

export function parseWarning(text: string): WarningSection[] | null {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return null;

  const marks = [...t.matchAll(SECTION_RE)];
  const segments: { heading: string | null; body: string }[] = [];

  if (marks.length === 0) {
    segments.push({ heading: null, body: t });
  } else {
    marks.forEach((m, i) => {
      const from = (m.index ?? 0) + m[0].length;
      const to = i + 1 < marks.length ? (marks[i + 1].index ?? t.length) : t.length;
      const seg = t.slice(from, to).trim();
      const firstItem = seg.search(/(?:^|\s)\d+\)\s/);
      segments.push(
        firstItem > 0
          ? { heading: seg.slice(0, firstItem).trim(), body: seg.slice(firstItem).trim() }
          : { heading: null, body: seg },
      );
    });
  }

  const sections: WarningSection[] = [];
  for (const seg of segments) {
    const items = seg.body.split(ITEM_SPLIT_RE).map(s => s.trim()).filter(Boolean)
      .map(parseItem)
      .filter((x): x is WarningItem => x !== null);
    if (items.length > 0) sections.push({ heading: seg.heading, items });
  }
  return sections.length > 0 ? sections : null;
}

// ── Which state is an area? (to put the rider's own state first) ────────────

const ALIASES: Record<string, StateCode> = {
  'penang': 'PNG',
  'pulau pinang': 'PNG',
  'kuala lumpur': 'WLH',
  'wp kuala lumpur': 'WLH',
  'putrajaya': 'PTJ',
  'wp putrajaya': 'PTJ',
  'labuan': 'WLP',
  'wp labuan': 'WLP',
  'n sembilan': 'NSN',
  'negeri sembilan': 'NSN',
};

const norm = (s: string) => s.toLowerCase().replace(/[.:]/g, '').replace(/\s+/g, ' ').trim();

/** "W.P. Kuala Lumpur" / "N. Sembilan" / "Selangor" → state code, else null. */
export function stateOfArea(name: string): StateCode | null {
  const n = norm(name);
  if (ALIASES[n]) return ALIASES[n];
  for (const s of STATES) {
    if (norm(s.name) === n || norm(s.short) === n) return s.code;
  }
  return null;
}
