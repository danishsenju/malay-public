import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

// Lists every route for a network, for the map's route picker.
// Only networks that support per-route filtering are exposed here - KTM is a
// single unified live view (its realtime feed carries no routeId), so it is not
// a valid value.
const ALLOWED = new Set(['rapid-bus-kl'])

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const network = searchParams.get('network')?.trim() ?? 'rapid-bus-kl'

  if (!ALLOWED.has(network)) {
    return NextResponse.json(
      { error: `Unsupported network "${network}". Supported: ${[...ALLOWED].join(', ')}` },
      { status: 400 },
    )
  }

  const { data, error } = await getSupabaseAdmin()
    .from('routes')
    .select('route_id, route_short_name, route_long_name, route_color')
    .eq('network', network)
    .order('route_short_name')
    .limit(1000)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
