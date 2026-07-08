import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

// Returns the drawable shape(s) for a single bus route, plus its colour.
// A route can have several shape variants (directions / pattern variations);
// each is returned as its own ordered polyline so the map draws them as one
// combined coloured line without connecting the ends together.
//
// shapes rows can exceed PostgREST's default 1000-row cap for a long route, so
// we page through with .range() until a short page comes back.

const ALLOWED = new Set(['rapid-bus-kl'])
const PAGE = 1000

type ShapePoint = { shape_id: string; lat: number; lon: number }

export async function GET(
  request: Request,
  { params }: { params: Promise<{ routeId: string }> },
) {
  const { routeId } = await params
  const { searchParams } = new URL(request.url)
  const network = searchParams.get('network')?.trim() ?? 'rapid-bus-kl'

  if (!ALLOWED.has(network)) {
    return NextResponse.json(
      { error: `Unsupported network "${network}"` },
      { status: 400 },
    )
  }

  const db = getSupabaseAdmin()

  // Route colour (may be null → client falls back to cobalt).
  const { data: routeRow, error: routeErr } = await db
    .from('routes')
    .select('route_color')
    .eq('network', network)
    .eq('route_id', routeId)
    .maybeSingle()

  if (routeErr) return NextResponse.json({ error: routeErr.message }, { status: 500 })

  // Distinct shape_ids for this route.
  const { data: trm, error: trmErr } = await db
    .from('trip_route_map')
    .select('shape_id')
    .eq('network', network)
    .eq('route_id', routeId)
    .not('shape_id', 'is', null)

  if (trmErr) return NextResponse.json({ error: trmErr.message }, { status: 500 })

  const shapeIds = [...new Set((trm ?? []).map(r => r.shape_id as string).filter(Boolean))]

  if (shapeIds.length === 0) {
    return NextResponse.json({ color: routeRow?.route_color ?? null, variants: [] })
  }

  // Page through all points for these shapes, ordered so each variant is contiguous.
  const points: ShapePoint[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from('shapes')
      .select('shape_id, lat, lon')
      .eq('network', network)
      .in('shape_id', shapeIds)
      .order('shape_id')
      .order('sequence')
      .range(from, from + PAGE - 1)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data || data.length === 0) break
    points.push(...(data as ShapePoint[]))
    if (data.length < PAGE) break
  }

  // Group into one [ [lat,lon], ... ] polyline per shape_id.
  const byShape = new Map<string, [number, number][]>()
  for (const p of points) {
    let arr = byShape.get(p.shape_id)
    if (!arr) { arr = []; byShape.set(p.shape_id, arr) }
    arr.push([p.lat, p.lon])
  }

  return NextResponse.json({
    color: routeRow?.route_color ?? null,
    variants: [...byShape.values()],
  })
}
