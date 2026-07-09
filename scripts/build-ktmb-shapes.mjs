/**
 * Sampai Bila? — real KTMB track geometry builder
 *
 * The KTMB GTFS feed ships no shapes.txt, so the live map used to draw each
 * line as station-to-station straight chords — visibly wrong next to the real
 * curving railway on the basemap. This script builds true track polylines:
 *
 *   1. Pulls each route's station sequence from the running dev server
 *      (http://localhost:3000/api/ktmb/lines — the chord version).
 *   2. Downloads every railway=rail way in Peninsular Malaysia from
 *      OpenStreetMap (Overpass API), cached locally between runs.
 *   3. Builds a rail graph and Dijkstra-routes every consecutive station
 *      pair along the actual track; falls back to the straight chord for
 *      any pair the graph can't connect (and says so).
 *   4. Simplifies (Douglas-Peucker, ~8 m) and writes src/data/ktmbShapes.json,
 *      which /api/ktmb/lines prefers over chords.
 *
 * Usage:  node scripts/build-ktmb-shapes.mjs   (dev server must be running)
 * Re-run whenever KTMB adds stations or OSM fixes track data.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import path from 'path'

const LINES_URL = 'http://localhost:3000/api/ktmb/lines'
const CACHE_DIR = path.join(process.cwd(), '.cache')
const OSM_CACHE = path.join(CACHE_DIR, 'osm-rail-malaysia.json')
const OUT_FILE = path.join(process.cwd(), 'src', 'data', 'ktmbShapes.json')

// Peninsular Malaysia + Woodlands (Shuttle Tebrau) + Padang Besar.
const BBOX = '1.1,99.5,6.8,104.1'
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
]

// A real station sits ON the railway. One with no track node within this is
// mislocated in the feed (Mengkuang is 232 km off) — drop it entirely rather
// than draw a chord out to a phantom point.
const STATION_ON_RAIL_M = 1200
// Give up a pair when Dijkstra cost exceeds this cap. Generous on purpose:
// snapping is restricted to the connected mainline, so any path found IS the
// real track — the cap only guards against runaway searches. (The KKB
// realignment legitimately detours far west of the station chord.)
const maxCost = chord => Math.max(chord * 8, chord + 80_000)
const SIMPLIFY_TOLERANCE_M = 8
// Consecutive stations closer than this are the same placeholder coordinate
// (the KTMB feed gives clusters of rural halts one shared point ~150 m wide;
// real adjacent KTM stations are never under 800 m apart).
const DEDUPE_M = 300

const R = 6371000
function distM(aLat, aLon, bLat, bLon) {
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLon = ((bLon - aLon) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

// ── 1. Station sequences ─────────────────────────────────────────────────────

async function fetchLines() {
  const res = await fetch(LINES_URL)
  if (!res.ok) throw new Error(`GET ${LINES_URL} → ${res.status}. Is the dev server running?`)
  const { lines } = await res.json()
  return lines
}

// ── 2. OSM rail ways (cached) ────────────────────────────────────────────────

async function fetchOsmRail() {
  if (existsSync(OSM_CACHE)) {
    console.log(`using cached OSM data: ${OSM_CACHE}`)
    return JSON.parse(readFileSync(OSM_CACHE, 'utf8'))
  }
  // Keep crossovers: on double-tracked lines the two parallel tracks only
  // join through service=crossover ways — dropping them cuts the graph into
  // disjoint parallel strands and Dijkstra fails across them.
  const query = `[out:json][timeout:300];way["railway"="rail"]["service"!~"yard|siding|spur"](${BBOX});out geom;`
  let lastErr
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      console.log(`fetching rail ways from ${endpoint} …`)
      const res = await fetch(endpoint, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          // overpass-api.de 406s anonymous default UAs — identify ourselves.
          'User-Agent': 'TransitMY-shape-builder/1.0 (one-time GTFS shape generation)',
        },
      })
      if (!res.ok) throw new Error(`overpass → ${res.status}`)
      const data = await res.json()
      if (!data.elements?.length) throw new Error('overpass returned no elements')
      mkdirSync(CACHE_DIR, { recursive: true })
      writeFileSync(OSM_CACHE, JSON.stringify(data))
      console.log(`cached ${data.elements.length} ways → ${OSM_CACHE}`)
      return data
    } catch (e) {
      lastErr = e
      console.warn(`  failed: ${e.message}`)
    }
  }
  throw lastErr
}

// ── 3. Rail graph ────────────────────────────────────────────────────────────

function buildGraph(osm) {
  const keyToIdx = new Map()
  const lat = []
  const lon = []
  const adj = [] // adj[i] = [j0, d0, j1, d1, …] flattened

  function nodeIdx(la, lo) {
    // OSM shared nodes have byte-identical coords in the response, so the
    // string key merges ways at junctions without any tolerance games.
    const key = la + ',' + lo
    let idx = keyToIdx.get(key)
    if (idx === undefined) {
      idx = lat.length
      keyToIdx.set(key, idx)
      lat.push(la)
      lon.push(lo)
      adj.push([])
    }
    return idx
  }

  for (const way of osm.elements) {
    if (!way.geometry || way.geometry.length < 2) continue
    let prev = nodeIdx(way.geometry[0].lat, way.geometry[0].lon)
    for (let i = 1; i < way.geometry.length; i++) {
      const cur = nodeIdx(way.geometry[i].lat, way.geometry[i].lon)
      const d = distM(lat[prev], lon[prev], lat[cur], lon[cur])
      adj[prev].push(cur, d)
      adj[cur].push(prev, d)
      prev = cur
    }
  }

  // Restrict snapping to the giant connected component. Disconnected scraps
  // (detached platform tracks, industrial stubs, half-mapped segments) would
  // otherwise capture a station's nearest-node and make every Dijkstra from
  // it fail even though the mainline runs 50 m away.
  const comp = new Int32Array(lat.length).fill(-1)
  let nComp = 0
  const compSize = []
  for (let seed = 0; seed < lat.length; seed++) {
    if (comp[seed] !== -1) continue
    const stack = [seed]
    comp[seed] = nComp
    let size = 0
    while (stack.length) {
      const n = stack.pop()
      size++
      const edges = adj[n]
      for (let i = 0; i < edges.length; i += 2) {
        if (comp[edges[i]] === -1) { comp[edges[i]] = nComp; stack.push(edges[i]) }
      }
    }
    compSize.push(size)
    nComp++
  }
  const giant = compSize.indexOf(Math.max(...compSize))
  console.log(`components: ${nComp}, giant has ${compSize[giant]}/${lat.length} nodes`)

  // Spatial grid for nearest-node lookup (0.01° ≈ 1.1 km cells).
  const grid = new Map()
  for (let i = 0; i < lat.length; i++) {
    if (comp[i] !== giant) continue
    const key = Math.floor(lat[i] * 100) + ':' + Math.floor(lon[i] * 100)
    let arr = grid.get(key)
    if (!arr) { arr = []; grid.set(key, arr) }
    arr.push(i)
  }

  function nearest(la, lo, maxM) {
    const cl = Math.floor(la * 100)
    const co = Math.floor(lo * 100)
    let best = -1
    let bestD = maxM
    const rings = Math.ceil(maxM / 1100) + 1
    for (let r = 0; r <= rings; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dy), Math.abs(dx)) !== r) continue // ring shell only
          const arr = grid.get((cl + dy) + ':' + (co + dx))
          if (!arr) continue
          for (const i of arr) {
            const d = distM(la, lo, lat[i], lon[i])
            if (d < bestD) { bestD = d; best = i }
          }
        }
      }
      if (best !== -1 && r > Math.ceil(bestD / 1100)) break // can't improve
    }
    return best
  }

  return { lat, lon, adj, nearest, size: lat.length }
}

// Binary min-heap of [dist, node].
class Heap {
  constructor() { this.a = [] }
  push(d, n) {
    const a = this.a
    a.push([d, n])
    let i = a.length - 1
    while (i > 0) {
      const p = (i - 1) >> 1
      if (a[p][0] <= a[i][0]) break
      ;[a[p], a[i]] = [a[i], a[p]]
      i = p
    }
  }
  pop() {
    const a = this.a
    const top = a[0]
    const last = a.pop()
    if (a.length > 0) {
      a[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < a.length && a[l][0] < a[m][0]) m = l
        if (r < a.length && a[r][0] < a[m][0]) m = r
        if (m === i) break
        ;[a[m], a[i]] = [a[i], a[m]]
        i = m
      }
    }
    return top
  }
  get empty() { return this.a.length === 0 }
}

function dijkstra(graph, from, to, maxCost) {
  const dist = new Map([[from, 0]])
  const prev = new Map()
  const heap = new Heap()
  heap.push(0, from)
  while (!heap.empty) {
    const [d, n] = heap.pop()
    if (n === to) {
      const path = [to]
      let cur = to
      while (prev.has(cur)) { cur = prev.get(cur); path.push(cur) }
      return path.reverse()
    }
    if (d > (dist.get(n) ?? Infinity) || d > maxCost) continue
    const edges = graph.adj[n]
    for (let i = 0; i < edges.length; i += 2) {
      const m = edges[i]
      const nd = d + edges[i + 1]
      if (nd < (dist.get(m) ?? Infinity)) {
        dist.set(m, nd)
        prev.set(m, n)
        heap.push(nd, m)
      }
    }
  }
  return null
}

// ── 4. Simplify (Douglas-Peucker, metres) ────────────────────────────────────

function simplify(points, tolM) {
  if (points.length < 3) return points
  const keep = new Uint8Array(points.length)
  keep[0] = keep[points.length - 1] = 1
  const mLat = 111320
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()
    const cos = Math.cos((points[a][0] * Math.PI) / 180)
    const ax = points[a][1] * cos * mLat, ay = points[a][0] * mLat
    const bx = points[b][1] * cos * mLat, by = points[b][0] * mLat
    const dx = bx - ax, dy = by - ay
    const len2 = dx * dx + dy * dy
    let worst = -1, worstD = tolM
    for (let i = a + 1; i < b; i++) {
      const px = points[i][1] * cos * mLat - ax
      const py = points[i][0] * mLat - ay
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (px * dx + py * dy) / len2))
      const d = Math.hypot(px - t * dx, py - t * dy)
      if (d > worstD) { worstD = d; worst = i }
    }
    if (worst !== -1) {
      keep[worst] = 1
      stack.push([a, worst], [worst, b])
    }
  }
  return points.filter((_, i) => keep[i])
}

// ── Main ─────────────────────────────────────────────────────────────────────

const [lines, osm] = await Promise.all([fetchLines(), fetchOsmRail()])
console.log(`building graph …`)
const graph = buildGraph(osm)
console.log(`graph: ${graph.size} nodes`)

const pairCache = new Map()
const shapes = {}
let totalPairs = 0
let chordFallbacks = 0

/**
 * The KTMB feed's station coordinates are dirty: clusters of rural halts
 * share one placeholder point, and a few stations are flat-out mislocated
 * (Mengkuang sits 232 km away in the wrong state). Clean the sequence first:
 * collapse duplicate points, then drop any station whose detour
 * (prev→it→next) is absurd versus the direct prev→next hop — a mislocated
 * point, not a real routing.
 */
function cleanStations(path) {
  // 0. Drop stations that aren't on (or near) any mainline track — their
  //    coordinates are wrong in the feed, so routing to them draws fiction.
  const onRail = path.filter(p => graph.nearest(p[0], p[1], STATION_ON_RAIL_M) !== -1)
  if (onRail.length < path.length) {
    console.warn(`  dropped ${path.length - onRail.length} station(s) with no track within ${STATION_ON_RAIL_M} m`)
  }
  // 1. Collapse consecutive near-identical points.
  let pts = onRail.filter((p, i) => i === 0 || distM(p[0], p[1], onRail[i - 1][0], onRail[i - 1][1]) > DEDUPE_M)
  // 2. Outlier rejection, repeated until stable (dropping one outlier can
  //    expose its neighbour as the next).
  for (let pass = 0; pass < 5; pass++) {
    const drop = new Set()
    for (let i = 1; i < pts.length - 1; i++) {
      const dPrev = distM(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])
      const dNext = distM(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1])
      const dSkip = distM(pts[i - 1][0], pts[i - 1][1], pts[i + 1][0], pts[i + 1][1])
      if (dPrev + dNext > Math.max(3 * dSkip, dSkip + 60_000)) drop.add(i)
    }
    if (drop.size === 0) break
    console.warn(`  dropped ${drop.size} mislocated station(s): ${[...drop].map(i => `(${pts[i][0]},${pts[i][1]})`).join(' ')}`)
    pts = pts.filter((_, i) => !drop.has(i))
  }
  return pts
}

for (const line of lines) {
  const out = []
  const push = p => {
    const last = out[out.length - 1]
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
  }

  const stations = cleanStations(line.path)
  for (let i = 0; i < stations.length - 1; i++) {
    const [aLat, aLon] = stations[i]
    const [bLat, bLon] = stations[i + 1]
    totalPairs++
    const cacheKey = aLat.toFixed(4) + ',' + aLon.toFixed(4) + '>' + bLat.toFixed(4) + ',' + bLon.toFixed(4)
    let seg = pairCache.get(cacheKey)
    if (seg === undefined) {
      seg = null
      const na = graph.nearest(aLat, aLon, STATION_ON_RAIL_M)
      const nb = graph.nearest(bLat, bLon, STATION_ON_RAIL_M)
      if (na !== -1 && nb !== -1 && na !== nb) {
        const chord = distM(aLat, aLon, bLat, bLon)
        const nodePath = dijkstra(graph, na, nb, maxCost(chord))
        if (nodePath) seg = nodePath.map(n => [graph.lat[n], graph.lon[n]])
      }
      pairCache.set(cacheKey, seg)
    }
    if (seg) {
      for (const p of seg) push(p)
    } else {
      chordFallbacks++
      console.warn(`  chord fallback ${line.route_id} pair ${i}: (${aLat},${aLon}) → (${bLat},${bLon})`)
      push([aLat, aLon])
      push([bLat, bLon])
    }
  }

  const simplified = simplify(out, SIMPLIFY_TOLERANCE_M).map(p => [
    Math.round(p[0] * 1e6) / 1e6,
    Math.round(p[1] * 1e6) / 1e6,
  ])
  shapes[line.route_id] = simplified
  console.log(`${line.route_id.padEnd(12)} ${String(line.path.length).padStart(3)} stops (${stations.length} clean) → ${String(simplified.length).padStart(5)} pts`)
}

writeFileSync(OUT_FILE, JSON.stringify(shapes))
const kb = Math.round(Buffer.byteLength(JSON.stringify(shapes)) / 1024)
console.log(`\nwrote ${OUT_FILE} (${kb} KB)`)
console.log(`pairs: ${totalPairs}, chord fallbacks: ${chordFallbacks} (${((chordFallbacks / totalPairs) * 100).toFixed(1)}%)`)
if (chordFallbacks / totalPairs > 0.1) {
  console.warn('⚠ more than 10% of station pairs fell back to straight chords — check OSM coverage')
}
