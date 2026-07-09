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

// Colours match route_color in the data.gov.my GTFS routes table (current
// official line colours), not the older map palette.
const LINE_MAP: [string, LineInfo][] = [
  ['BRT', { name: 'BRT Sunway',        type: 'BRT',      color: '#115740' }],
  ['ERL', { name: 'KLIA Ekspres',       type: 'ERL',      color: '#003087' }],
  ['AGL', { name: 'Ampang Line',        type: 'LRT',      color: '#E57200' }],  // combined-section trips
  ['KJ',  { name: 'Kelana Jaya Line',   type: 'LRT',      color: '#D50032' }],
  ['AG',  { name: 'Ampang Line',        type: 'LRT',      color: '#E57200' }],
  ['SP',  { name: 'Sri Petaling Line',  type: 'LRT',      color: '#76232F' }],
  ['SA',  { name: 'Shah Alam Line',     type: 'LRT',      color: '#FF00FF' }],
  ['MR',  { name: 'KL Monorail',        type: 'Monorail', color: '#84BD00' }],
  ['KG',  { name: 'Kajang Line',        type: 'MRT',      color: '#047940' }],
  ['PY',  { name: 'Putrajaya Line',     type: 'MRT',      color: '#FFCD00' }],
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
