import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import type { NearbyStop } from '@/lib/types'

/**
 * Stop search with relevance ranking.
 *
 * Alphabetical order alone buries the station you want: searching "stadium
 * shah alam" put the *bus* stop "LRT STADIUM SHAH ALAM" above the actual LRT
 * station "STADIUM SHAH ALAM" (L sorts before S), so people picked the bus
 * pole by mistake and cross-network planning refused it.
 *
 * We now over-fetch, then score each hit so that: exact names win, then
 * word-start matches, then rail/KTM stations over bus poles (a bus stop named
 * after a station is almost never what someone typing the station name wants),
 * then shorter (closer) names. The list still contains every match — just in
 * the order a human means.
 */

const FETCH_LIMIT = 60
const RETURN_LIMIT = 14

// Rail + KTM are "real stations"; bus poles rank below when names collide.
const NETWORK_RANK: Record<string, number> = {
  'rapid-rail-kl': 2,
  'ktmb': 2,
  'rapid-bus-kl': 0,
}

function score(stop: NearbyStop, q: string): number {
  const name = stop.stop_name.toLowerCase()
  let s = 0
  if (name === q) s += 1000
  if (name.startsWith(q)) s += 200
  // whole-word hit (" stadium…" as its own token) beats a mid-word substring
  if (new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(name)) s += 60
  s += (NETWORK_RANK[stop.network] ?? 0) * 40
  s -= name.length * 0.2   // shorter = closer to the query
  return s
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const q       = searchParams.get('q')?.trim()       ?? ''
  const network = searchParams.get('network')?.trim() ?? ''

  if (q.length < 2) return NextResponse.json([])

  let query = getSupabaseAdmin()
    .from('stops')
    .select('stop_id, stop_name, network, stop_lat, stop_lon')
    .ilike('stop_name', `%${q}%`)
    .order('stop_name')
    .limit(FETCH_LIMIT)

  if (network) {
    query = query.eq('network', network)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const qLower = q.toLowerCase()
  const ranked = ((data ?? []) as NearbyStop[])
    .map(stop => ({ stop, s: score(stop, qLower) }))
    .sort((a, b) => b.s - a.s || a.stop.stop_name.localeCompare(b.stop.stop_name))
    .slice(0, RETURN_LIMIT)
    .map(r => r.stop)

  return NextResponse.json(ranked)
}
