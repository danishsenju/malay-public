/**
 * Derives the transit line and transport type from a Prasarana GTFS stop_id prefix.
 * Longer prefixes are checked first so "BRT" is matched before "B", etc.
 *
 * Source: Prasarana open GTFS stops.txt — stop_ids follow a consistent
 * {LINE_CODE}{sequence} format (e.g. "KJ13", "MR5", "PY22").
 */

export type TransportType = 'LRT' | 'MRT' | 'Monorail' | 'BRT' | 'ERL'

export interface LineInfo {
  name:  string           // e.g. "Kelana Jaya Line"
  type:  TransportType    // e.g. "LRT" — shown to users who don't know line names
  color: string           // hex, matches official line colour
}

const LINE_MAP: [string, LineInfo][] = [
  ['BRT', { name: 'BRT Sunway',        type: 'BRT',      color: '#005C88' }],
  ['ERL', { name: 'KLIA Ekspres',       type: 'ERL',      color: '#003087' }],
  ['AGL', { name: 'Ampang Line',        type: 'LRT',      color: '#FF8000' }],  // combined-section trips
  ['KJ',  { name: 'Kelana Jaya Line',   type: 'LRT',      color: '#009EE0' }],
  ['AG',  { name: 'Ampang Line',        type: 'LRT',      color: '#FF8000' }],
  ['SP',  { name: 'Sri Petaling Line',  type: 'LRT',      color: '#9B1C31' }],
  ['MR',  { name: 'KL Monorail',        type: 'Monorail', color: '#EE2024' }],
  ['KG',  { name: 'Kajang Line',        type: 'MRT',      color: '#007F55' }],
  ['PY',  { name: 'Putrajaya Line',     type: 'MRT',      color: '#3C3799' }],
]

/**
 * Returns line info for a rapid-rail-kl stop, or null if unrecognised.
 * Pass the raw GTFS stop_id (e.g. "KJ13", "MR5").
 */
export function getRailLine(stopId: string): LineInfo | null {
  const id = stopId.toUpperCase()
  for (const [prefix, info] of LINE_MAP) {
    if (id.startsWith(prefix)) return info
  }
  return null
}
