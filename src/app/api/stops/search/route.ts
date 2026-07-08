import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '@/lib/supabase'

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
    .limit(14)

  if (network) {
    query = query.eq('network', network)
  }

  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}
