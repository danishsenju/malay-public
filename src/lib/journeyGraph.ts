/**
 * Multi-network journey graph - the piece that lets Rancang connect
 * MRT ↔ LRT ↔ Monorail ↔ KTM instead of refusing at network borders.
 *
 * GTFS gives every line its own stop_ids even at shared stations (Masjid
 * Jamek is KJ13, AG7 AND SP7), so "same stop_id" transfers never exist
 * across lines. Instead we detect interchanges by geography: any two stops
 * on DIFFERENT lines within WALK_MAX_M of each other are a walking transfer.
 * That single rule finds Masjid Jamek, KL Sentral ↔ Muzium Negara,
 * Pasar Seni (LRT ↔ MRT ↔ KTM), Titiwangsa, TRX, Bukit Bintang, … with no
 * hand-maintained table, and automatically picks up new lines (e.g. the
 * Shah Alam LRT) as they appear in the feed.
 *
 * Routing happens at LINE level: BFS over "which lines connect to which",
 * then each line-leg is timed against the real timetable with the existing
 * direct_journeys RPC. KTMB is one pseudo-line - its internal branch
 * transfers share physical stop_ids and are handled by the RPC layer.
 */

import { getSupabaseAdmin } from './supabase'
import type { Network } from './types'

export interface GraphStop {
  stop_id: string
  stop_name: string
  network: Network
  lat: number
  lon: number
  /** 'KJ' | 'AG' | 'SP' | 'SA' | 'MR' | 'KG' | 'PY' | 'BRT' | 'KTMB' */
  line: string
}

export interface TransferLink {
  from: GraphStop
  to: GraphStop
  distM: number
  walkSecs: number
}

interface Graph {
  builtAt: number
  stops: Map<string, GraphStop>            // key `${network}:${stop_id}`
  byLine: Map<string, GraphStop[]>
  /** Directed transfer links grouped by `${fromLine}>${toLine}`, nearest first. */
  links: Map<string, TransferLink[]>
  /** Line adjacency for BFS. */
  adjacency: Map<string, Set<string>>
}

// Stops within this distance on different lines count as a walking transfer.
// 500 m covers every real Klang Valley interchange walkway (KL Sentral ↔
// Muzium Negara, Bukit Nanas ↔ Dang Wangi) without bridging unrelated stations.
const WALK_MAX_M = 500
// Detour factor × walking pace, plus a fixed buffer for gates/platforms.
const WALK_BUFFER_SECS = 120
const WALK_SECS_PER_M = 1.4 / 1.2

const GRAPH_TTL_MS = 6 * 60 * 60 * 1000

// Longest prefixes first so BRT wins over B…
const RAIL_PREFIXES = ['BRT', 'AG', 'PY', 'KJ', 'SP', 'KG', 'MR', 'SA', 'ERL'] as const

export function lineOfStop(stopId: string, network: Network): string | null {
  if (network === 'ktmb') return 'KTMB'
  if (network !== 'rapid-rail-kl') return null
  const id = stopId.toUpperCase()
  for (const p of RAIL_PREFIXES) {
    if (id.startsWith(p)) return p
  }
  return null
}

export function haversineM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLon = ((bLon - aLon) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function walkSecsFor(distM: number): number {
  return Math.round(WALK_BUFFER_SECS + distM * WALK_SECS_PER_M)
}

let graphCache: Graph | null = null
let graphPromise: Promise<Graph> | null = null

async function buildGraph(): Promise<Graph> {
  const db = getSupabaseAdmin()
  const { data, error } = await db
    .from('stops')
    .select('stop_id, stop_name, network, stop_lat, stop_lon')
    .in('network', ['rapid-rail-kl', 'ktmb'])
    .limit(2000)
  if (error) throw new Error(`journey graph: ${error.message}`)

  const stops = new Map<string, GraphStop>()
  const byLine = new Map<string, GraphStop[]>()

  for (const row of data ?? []) {
    const line = lineOfStop(row.stop_id, row.network as Network)
    if (!line) continue
    const stop: GraphStop = {
      stop_id: row.stop_id,
      stop_name: row.stop_name,
      network: row.network as Network,
      lat: row.stop_lat,
      lon: row.stop_lon,
      line,
    }
    stops.set(`${stop.network}:${stop.stop_id}`, stop)
    let arr = byLine.get(line)
    if (!arr) { arr = []; byLine.set(line, arr) }
    arr.push(stop)
  }

  // Pairwise proximity across different lines → directed transfer links.
  const links = new Map<string, TransferLink[]>()
  const adjacency = new Map<string, Set<string>>()
  const all = [...stops.values()]
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]
      const b = all[j]
      if (a.line === b.line) continue
      // Cheap latitude gate before the trig (0.0045° ≈ 500 m).
      if (Math.abs(a.lat - b.lat) > 0.0046) continue
      const dist = haversineM(a.lat, a.lon, b.lat, b.lon)
      if (dist > WALK_MAX_M) continue
      const walkSecs = walkSecsFor(dist)
      for (const [x, y] of [[a, b], [b, a]] as const) {
        const key = `${x.line}>${y.line}`
        let arr = links.get(key)
        if (!arr) { arr = []; links.set(key, arr) }
        arr.push({ from: x, to: y, distM: Math.round(dist), walkSecs })
        let adj = adjacency.get(x.line)
        if (!adj) { adj = new Set(); adjacency.set(x.line, adj) }
        adj.add(y.line)
      }
    }
  }
  for (const arr of links.values()) arr.sort((a, b) => a.distM - b.distM)

  return { builtAt: Date.now(), stops, byLine, links, adjacency }
}

export async function getGraph(): Promise<Graph> {
  if (graphCache && Date.now() - graphCache.builtAt < GRAPH_TTL_MS) return graphCache
  if (!graphPromise) {
    graphPromise = buildGraph()
      .then(g => { graphCache = g; return g })
      .finally(() => { graphPromise = null })
  }
  return graphPromise
}

/** Ways to be ON a given line starting from `stop` - itself (walk 0) plus any
 *  transfer-linked stop on another line. */
export function lineEntries(graph: Graph, stop: GraphStop): Map<string, { stop: GraphStop; walkSecs: number; distM: number }> {
  const entries = new Map<string, { stop: GraphStop; walkSecs: number; distM: number }>()
  entries.set(stop.line, { stop, walkSecs: 0, distM: 0 })
  for (const [key, arr] of graph.links) {
    if (!key.startsWith(`${stop.line}>`)) continue
    for (const link of arr) {
      if (link.from.stop_id !== stop.stop_id || link.from.network !== stop.network) continue
      const existing = entries.get(link.to.line)
      if (!existing || link.walkSecs < existing.walkSecs) {
        entries.set(link.to.line, { stop: link.to, walkSecs: link.walkSecs, distM: link.distM })
      }
    }
  }
  return entries
}

/** All simple line sequences from any start line to any goal line, shortest
 *  first, with at most `maxLines` lines (maxLines - 1 transfers). */
export function findLinePaths(
  graph: Graph,
  startLines: Set<string>,
  goalLines: Set<string>,
  maxLines = 3,
  maxPaths = 6,
): string[][] {
  const paths: string[][] = []
  const queue: string[][] = [...startLines].map(l => [l])
  while (queue.length > 0 && paths.length < maxPaths) {
    const path = queue.shift()!
    const last = path[path.length - 1]
    if (goalLines.has(last)) {
      paths.push(path)
      continue
    }
    if (path.length >= maxLines) continue
    for (const next of graph.adjacency.get(last) ?? []) {
      if (path.includes(next)) continue
      queue.push([...path, next])
    }
  }
  return paths
}

/** Best transfer links between two lines, ranked so the interchange lies
 *  roughly on the way from origin to destination. */
export function junctionCandidates(
  graph: Graph,
  fromLine: string,
  toLine: string,
  origin: GraphStop,
  dest: GraphStop,
  take = 2,
): TransferLink[] {
  const arr = graph.links.get(`${fromLine}>${toLine}`) ?? []
  return [...arr]
    .sort(
      (a, b) =>
        haversineM(origin.lat, origin.lon, a.from.lat, a.from.lon) +
        haversineM(a.to.lat, a.to.lon, dest.lat, dest.lon) -
        (haversineM(origin.lat, origin.lon, b.from.lat, b.from.lon) +
          haversineM(b.to.lat, b.to.lon, dest.lat, dest.lon)),
    )
    .slice(0, take)
}

export function networkOfLine(line: string): Network {
  return line === 'KTMB' ? 'ktmb' : 'rapid-rail-kl'
}

/** Seconds since midnight, Malaysia Standard Time (UTC+8, no DST). */
export function nowSecsMYT(): number {
  return Math.floor(((Date.now() / 1000) + 8 * 3600) % 86400)
}
