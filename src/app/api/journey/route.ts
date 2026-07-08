import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import type { JourneyLeg, JourneyOption, JourneyResponse } from '@/lib/types'

/**
 * Journey planner: A→B over the GTFS static graph in Supabase.
 *
 * 1. direct_journeys RPC — single-trip options (fixed + frequency-expanded)
 * 2. If none: transfer_points RPC ranks interchange candidates by hop count,
 *    then each candidate is timed as two chained direct legs with a 3-minute
 *    transfer buffer.
 *
 * Cross-network journeys (bus↔rail) are out of scope for now — the UI says
 * so honestly instead of pretending.
 */

const TRANSFER_BUFFER_SECS = 180

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

function toLeg(r: DirectRow): JourneyLeg {
  return {
    routeShortName: r.route_short_name,
    routeColor: r.route_color,
    routeTextColor: r.route_text_color,
    headsign: r.trip_headsign,
    depTime: r.dep_time,
    arrTime: r.arr_time,
    durationMin: r.duration_min,
    numStops: r.num_stops,
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const fromId = searchParams.get('fromId') ?? ''
  const toId = searchParams.get('toId') ?? ''
  const fromNet = searchParams.get('fromNet') ?? ''
  const toNet = searchParams.get('toNet') ?? ''

  if (!fromId || !toId || !fromNet || !toNet) {
    return NextResponse.json({ error: 'fromId, toId, fromNet, toNet are required' }, { status: 400 })
  }

  if (fromNet !== toNet) {
    const body: JourneyResponse = { options: [], sameNetwork: false, generatedAt: Date.now() }
    return NextResponse.json(body)
  }

  const db = getSupabaseAdmin()
  const options: JourneyOption[] = []

  // ── 1. Direct trips ────────────────────────────────────────────────────────
  const direct = await db.rpc('direct_journeys', {
    p_from: fromId,
    p_to: toId,
    p_network: fromNet,
  })
  if (direct.error) {
    return NextResponse.json({ error: direct.error.message }, { status: 500 })
  }

  for (const r of (direct.data ?? []) as DirectRow[]) {
    options.push({
      legs: [toLeg(r)],
      depTime: r.dep_time,
      arrTime: r.arr_time,
      totalMin: r.duration_min,
    })
  }

  // ── 2. One-transfer fallback (rail/KTMB — bus topology is too dense) ──────
  if (options.length === 0 && fromNet !== 'rapid-bus-kl') {
    const tp = await db.rpc('transfer_points', {
      p_from: fromId,
      p_to: toId,
      p_network: fromNet,
      p_limit: 3,
    })

    const candidates = (tp.data ?? []) as TransferRow[]
    const timed = await Promise.all(
      candidates.map(async candidate => {
        const leg1 = await db.rpc('direct_journeys', {
          p_from: fromId,
          p_to: candidate.stop_id,
          p_network: fromNet,
          p_limit: 1,
        })
        const first = ((leg1.data ?? []) as DirectRow[])[0]
        if (!first) return null

        const leg2 = await db.rpc('direct_journeys', {
          p_from: candidate.stop_id,
          p_to: toId,
          p_network: fromNet,
          p_after_secs: first.arr_secs + TRANSFER_BUFFER_SECS,
          p_limit: 1,
        })
        const second = ((leg2.data ?? []) as DirectRow[])[0]
        if (!second) return null

        const option: JourneyOption = {
          legs: [toLeg(first), toLeg(second)],
          transferStop: candidate.stop_name,
          depTime: first.dep_time,
          arrTime: second.arr_time,
          totalMin: Math.round((second.arr_secs - first.dep_secs) / 60),
        }
        return option
      }),
    )

    options.push(
      ...timed
        .filter((o): o is JourneyOption => o !== null)
        .sort((a, b) => a.totalMin - b.totalMin)
        .slice(0, 3),
    )
  }

  const body: JourneyResponse = { options, sameNetwork: true, generatedAt: Date.now() }
  return NextResponse.json(body, {
    headers: { 'Cache-Control': 's-maxage=30, stale-while-revalidate=60' },
  })
}
