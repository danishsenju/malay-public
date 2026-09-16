import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'
import { PLACES, type Place } from '@/data/places'
import type { NearbyStop } from '@/lib/types'

/**
 * Transit-accessible places: each curated place is checked against the live
 * stops table and returned WITH its nearest stop. Places with no stop within
 * WALK_RADIUS_M are dropped - "accessible by public transport" is verified,
 * not asserted.
 *
 * The whole list is computed at most once per REFRESH_MS per server instance
 * and is CDN-cacheable, so the per-place RPC fan-out almost never runs.
 */

const WALK_RADIUS_M = 1000
const REFRESH_MS = 12 * 60 * 60 * 1000
const BATCH = 12

export interface AccessiblePlace extends Place {
  access: NearbyStop
}

let cache: { at: number; places: AccessiblePlace[] } | null = null
let inflight: Promise<AccessiblePlace[]> | null = null

async function compute(): Promise<AccessiblePlace[]> {
  const db = getSupabaseAdmin()
  const out: AccessiblePlace[] = []

  for (let i = 0; i < PLACES.length; i += BATCH) {
    const batch = PLACES.slice(i, i + BATCH)
    const results = await Promise.all(
      batch.map(async place => {
        // Wide limit matters: around a mall the nearest 4 stops are ALWAYS
        // bus poles, so a small limit never surfaces the rail station 600 m
        // away - and a bus-anchored place can't be journey-planned from a
        // rail origin (bus cross-network is unsupported). 24 reaches past
        // the pole cluster to the station.
        const { data, error } = await db.rpc('nearby_stops', {
          p_lat: place.lat,
          p_lon: place.lon,
          p_radius_m: WALK_RADIUS_M,
          p_limit: 24,
        })
        if (error || !data) return null
        // Prefer rail/KTM stations over bus poles - a station anchors the
        // journey planner better; fall back to the nearest bus stop.
        const stops = data as NearbyStop[]
        const access =
          stops.find(s => s.network === 'rapid-rail-kl' || s.network === 'ktmb') ?? stops[0]
        return access ? { ...place, access } : null
      }),
    )
    out.push(...results.filter((p): p is AccessiblePlace => p !== null))
  }

  return out
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category')

  try {
    if (!cache || Date.now() - cache.at > REFRESH_MS) {
      if (!inflight) {
        inflight = compute().finally(() => { inflight = null })
      }
      cache = { at: Date.now(), places: await inflight }
    }

    const places = category
      ? cache.places.filter(p => p.category === category)
      : cache.places

    return NextResponse.json({ places }, {
      headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400' },
    })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'places lookup failed' },
      { status: 500 },
    )
  }
}
