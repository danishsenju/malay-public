import { NextResponse } from 'next/server';
import { fetchFloodFeed } from '@/lib/floodSource';
import { fetchWeatherFeed } from '@/lib/weatherSource';
import { fetchRecentDisruptions, type Disruption } from '@/lib/disruptions';
import { LEVEL_RANK } from '@/lib/flood';
import type { NearbyRiverSource } from '@/lib/nearbyFlood';

/** Cap on the location-free river list shipped to every Home visitor. */
const MAX_ELEVATED = 150;

/**
 * Home's status bento in one small payload (~1 KB): flood counts, active MET
 * warnings and live disruptions. The full flood feed is ~230 KB - fine for the
 * Cuaca page, far too heavy for a screen opened dozens of times a day.
 * Each part degrades on its own; a broken source is null, never a crash.
 */

export interface HomeStatus {
  flood: { danger: number; warning: number; alert: number; updatedAt: string | null; stale: boolean } | null;
  /**
   * Every river at Waspada or worse - no user data in it. The phone measures
   * distance to its own position (lib/nearbyFlood.ts); location never leaves it.
   */
  elevated: NearbyRiverSource[];
  metWarnings: number | null;
  disruptions: Disruption[];
  at: string;
}

export async function GET() {
  const [flood, weather, disruptions] = await Promise.allSettled([
    fetchFloodFeed(),
    fetchWeatherFeed(),
    // Every network the ledger watches (KTM + 11 bus networks), not just one.
    fetchRecentDisruptions({ limit: 10 }),
  ]);

  let floodSummary: HomeStatus['flood'] = null;
  const elevated: NearbyRiverSource[] = [];
  if (flood.status === 'fulfilled' && flood.value.stations.length > 0) {
    const c = { danger: 0, warning: 0, alert: 0 };
    for (const s of flood.value.stations) {
      if (s.level === 'danger' || s.level === 'warning' || s.level === 'alert') {
        c[s.level]++;
        elevated.push({
          id: s.id, name: s.name, lat: s.lat, lon: s.lon, state: s.state, district: s.district,
          level: s.level, waterLevelM: s.waterLevelM, thresholdM: s.thresholdM, trend: s.trend, levelAt: s.levelAt,
        });
      }
    }
    floodSummary = { ...c, updatedAt: flood.value.sourceUpdatedAt, stale: flood.value.stale };
    elevated.sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level]);
    elevated.length = Math.min(elevated.length, MAX_ELEVATED);
  }

  const body: HomeStatus = {
    flood: floodSummary,
    elevated,
    metWarnings: weather.status === 'fulfilled' ? weather.value.warnings.length : null,
    disruptions: disruptions.status === 'fulfilled' ? disruptions.value : [],
    at: new Date().toISOString(),
  };
  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  });
}
