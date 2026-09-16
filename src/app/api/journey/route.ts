import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import {
  findLinePaths,
  getGraph,
  junctionCandidates,
  lineEntries,
  networkOfLine,
  nowSecsMYT,
  type GraphStop,
  type TransferLink,
} from '@/lib/journeyGraph'
import type { JourneyLeg, JourneyOption, JourneyResponse, JourneyTransfer, Network } from '@/lib/types'

/**
 * Journey planner: A→B across the WHOLE rail + KTM network, not one route.
 *
 * 1. Same network → direct_journeys RPC (single ride, fixed + frequency).
 * 2. Same network, no direct → transfer_points RPC (shared-stop_id
 *    interchanges - mainly KTMB branches).
 * 3. Anything rail/KTM (same or cross network, cross LINE) → line-graph
 *    planner: BFS over lines joined by walking interchanges, each leg timed
 *    against the real timetable, chained with walk buffers.
 *
 * Bus ↔ other-network stays unsupported (the bus topology is too dense to
 * rank honestly) and the response says so instead of pretending.
 */

const TRANSFER_BUFFER_SECS = 180
const SAME_STATION_M = 150

interface DirectRow {
  trip_id: string
  route_id: string
  route_short_name: string | null
  route_color: string | null
  route_text_color: string | null
  trip_headsign: string | null
  dep_secs: number
  arr_secs: number
  dep_time: string
  arr_time: string
  duration_min: number
  num_stops: number
}

interface TransferRow {
  stop_id: string
  stop_name: string
  hops: number
}

function toLeg(r: DirectRow, network: Network, fromName: string, toName: string): JourneyLeg {
  return {
    routeShortName: r.route_short_name,
    routeColor: r.route_color,
    routeTextColor: r.route_text_color,
    headsign: r.trip_headsign,
    network,
    fromName,
    toName,
    depTime: r.dep_time,
    arrTime: r.arr_time,
    durationMin: r.duration_min,
    numStops: r.num_stops,
  }
}

function walkTransfer(link: TransferLink): JourneyTransfer {
  return {
    fromName: link.from.stop_name,
    toName: link.to.stop_name,
    walkMin: Math.max(1, Math.round(link.walkSecs / 60)),
    sameStation: link.distM <= SAME_STATION_M,
  }
}

async function directLeg(
  db: ReturnType<typeof getSupabaseAdmin>,
  fromId: string,
  toId: string,
  network: Network,
  afterSecs: number | null,
  limit = 1,
): Promise<DirectRow[]> {
  const res = await db.rpc('direct_journeys', {
    p_from: fromId,
    p_to: toId,
    p_network: network,
    p_after_secs: afterSecs,
    p_limit: limit,
  })
  if (res.error) throw new Error(res.error.message)
  return (res.data ?? []) as DirectRow[]
}

// ── Line-graph planning (rail ↔ rail cross-line, rail ↔ KTM, …) ──────────────

async function planViaGraph(
  db: ReturnType<typeof getSupabaseAdmin>,
  origin: GraphStop,
  dest: GraphStop,
): Promise<JourneyOption[]> {
  const graph = await getGraph()
  const originEntries = lineEntries(graph, origin)
  const destEntries = lineEntries(graph, dest)

  const paths = findLinePaths(graph, new Set(originEntries.keys()), new Set(destEntries.keys()))
  if (paths.length === 0) return []

  const baseNow = nowSecsMYT()

  // Each candidate = a line path + one concrete junction link per boundary.
  interface Candidate {
    path: string[]
    junctions: TransferLink[]
  }
  const candidates: Candidate[] = []
  for (const path of paths) {
    let combos: TransferLink[][] = [[]]
    for (let i = 0; i < path.length - 1; i++) {
      const cands = junctionCandidates(graph, path[i], path[i + 1], origin, dest, 2)
      if (cands.length === 0) { combos = []; break }
      combos = combos.flatMap(c => cands.map(j => [...c, j]))
    }
    for (const junctions of combos.slice(0, 4)) candidates.push({ path, junctions })
  }

  const timed = await Promise.all(
    candidates.slice(0, 8).map(async ({ path, junctions }): Promise<JourneyOption | null> => {
      try {
        const entry = originEntries.get(path[0])!
        const exit = destEntries.get(path[path.length - 1])!

        const legs: JourneyLeg[] = []
        const transfers: JourneyTransfer[] = []
        let after = baseNow + entry.walkSecs
        let firstDep = 0

        for (let i = 0; i < path.length; i++) {
          const fromStop = i === 0 ? entry.stop : junctions[i - 1].to
          const toStop = i === path.length - 1 ? exit.stop : junctions[i].from
          // Origin already standing at the junction (or dest is one): no ride
          // needed on this line - only valid at the path ends.
          if (fromStop.stop_id === toStop.stop_id && fromStop.network === toStop.network) return null

          const net = networkOfLine(path[i])
          const [row] = await directLeg(db, fromStop.stop_id, toStop.stop_id, net, after)
          if (!row) return null
          if (i === 0) firstDep = row.dep_secs
          legs.push(toLeg(row, net, fromStop.stop_name, toStop.stop_name))
          if (i < path.length - 1) {
            transfers.push(walkTransfer(junctions[i]))
            after = row.arr_secs + Math.max(junctions[i].walkSecs, TRANSFER_BUFFER_SECS)
          } else {
            after = row.arr_secs
          }
        }

        const startWalk =
          entry.walkSecs > 0
            ? {
                fromName: origin.stop_name,
                toName: entry.stop.stop_name,
                walkMin: Math.max(1, Math.round(entry.walkSecs / 60)),
                sameStation: entry.distM <= SAME_STATION_M,
              }
            : undefined
        const endWalk =
          exit.walkSecs > 0
            ? {
                fromName: exit.stop.stop_name,
                toName: dest.stop_name,
                walkMin: Math.max(1, Math.round(exit.walkSecs / 60)),
                sameStation: exit.distM <= SAME_STATION_M,
              }
            : undefined

        return {
          legs,
          transfers,
          startWalk,
          endWalk,
          depTime: legs[0].depTime,
          arrTime: legs[legs.length - 1].arrTime,
          totalMin: Math.round((after + exit.walkSecs - (firstDep - entry.walkSecs)) / 60),
        }
      } catch {
        return null
      }
    }),
  )

  // De-duplicate identical dep/arr pairs (two junction picks can converge).
  const seen = new Set<string>()
  return timed
    .filter((o): o is JourneyOption => o !== null)
    .filter(o => {
      const key = `${o.depTime}>${o.arrTime}>${o.legs.length}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => a.totalMin - b.totalMin)
    .slice(0, 3)
}

// ── Same-network shared-stop transfer (KTMB branches, bus excluded) ──────────

async function planSameNetworkTransfer(
  db: ReturnType<typeof getSupabaseAdmin>,
  fromId: string,
  toId: string,
  network: Network,
): Promise<JourneyOption[]> {
  const tp = await db.rpc('transfer_points', {
    p_from: fromId,
    p_to: toId,
    p_network: network,
    p_limit: 3,
  })
  const candidates = (tp.data ?? []) as TransferRow[]

  const timed = await Promise.all(
    candidates.map(async (candidate): Promise<JourneyOption | null> => {
      try {
        const [first] = await directLeg(db, fromId, candidate.stop_id, network, null)
        if (!first) return null
        const [second] = await directLeg(
          db, candidate.stop_id, toId, network, first.arr_secs + TRANSFER_BUFFER_SECS,
        )
        if (!second) return null
        return {
          legs: [
            toLeg(first, network, '', candidate.stop_name),
            toLeg(second, network, candidate.stop_name, ''),
          ],
          transfers: [{
            fromName: candidate.stop_name,
            toName: candidate.stop_name,
            walkMin: Math.round(TRANSFER_BUFFER_SECS / 60),
            sameStation: true,
          }],
          depTime: first.dep_time,
          arrTime: second.arr_time,
          totalMin: Math.round((second.arr_secs - first.dep_secs) / 60),
        }
      } catch {
        return null
      }
    }),
  )

  return timed
    .filter((o): o is JourneyOption => o !== null)
    .sort((a, b) => a.totalMin - b.totalMin)
    .slice(0, 3)
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const fromId = searchParams.get('fromId') ?? ''
  const toId = searchParams.get('toId') ?? ''
  const fromNet = (searchParams.get('fromNet') ?? '') as Network
  const toNet = (searchParams.get('toNet') ?? '') as Network

  if (!fromId || !toId || !fromNet || !toNet) {
    return NextResponse.json({ error: 'fromId, toId, fromNet, toNet are required' }, { status: 400 })
  }
  if (fromId === toId && fromNet === toNet) {
    return NextResponse.json({ error: 'from and to are the same stop' }, { status: 400 })
  }

  const busInvolved = fromNet === 'rapid-bus-kl' || toNet === 'rapid-bus-kl'
  if (busInvolved && fromNet !== toNet) {
    const body: JourneyResponse = { options: [], supported: false, generatedAt: Date.now() }
    return NextResponse.json(body)
  }

  const db = getSupabaseAdmin()

  try {
    let options: JourneyOption[] = []

    // 1. Single ride on one trip (same network only - cheap and exact).
    if (fromNet === toNet) {
      const rows = await directLeg(db, fromId, toId, fromNet, null, 6)
      options = rows.map(r => ({
        legs: [toLeg(r, fromNet, '', '')],
        transfers: [],
        depTime: r.dep_time,
        arrTime: r.arr_time,
        totalMin: r.duration_min,
      }))
    }

    // 2. Cross-line / cross-network via the interchange graph (rail + KTM).
    if (options.length === 0 && !busInvolved) {
      const graph = await getGraph()
      const origin = graph.stops.get(`${fromNet}:${fromId}`)
      const dest = graph.stops.get(`${toNet}:${toId}`)
      if (origin && dest) {
        options = await planViaGraph(db, origin, dest)
      }
    }

    // 3. Same-network shared-stop transfer (KTMB branch lines).
    if (options.length === 0 && fromNet === toNet && fromNet !== 'rapid-bus-kl') {
      options = await planSameNetworkTransfer(db, fromId, toId, fromNet)
    }

    const body: JourneyResponse = { options, supported: true, generatedAt: Date.now() }
    return NextResponse.json(body, {
      headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' },
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'journey planning failed' },
      { status: 500 },
    )
  }
}
