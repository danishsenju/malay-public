import { NextResponse } from 'next/server';
import { fetchWeatherFeed } from '@/lib/weatherSource';

/** MET Malaysia 7-day state forecasts + active warnings (via data.gov.my). */
export async function GET() {
  const feed = await fetchWeatherFeed();
  return NextResponse.json(feed, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' },
  });
}
