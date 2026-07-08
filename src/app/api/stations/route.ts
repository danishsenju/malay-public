import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

// All stations/stops for a network, for plotting static markers on the map.
// Used by the KTM unified view (191 stations). Kept separate from
// /api/stops/search, which is query-driven and capped at 14 results.
const ALLOWED = new Set(['ktmb'])

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const network = searchParams.get('network')?.trim() ?? 'ktmb'

  if (!ALLOWED.has(network)) {
    return NextResponse.json(
      { error: `Unsupported network "${network}". Supported: ${[...ALLOWED].join(', ')}` },
      { status: 400 },
    )
  }

  const { data, error } = await getSupabaseAdmin()
    .from('stops')
    .select('stop_id, stop_name, stop_lat, stop_lon')
    .eq('network', network)
    .limit(1000)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
