import { NextResponse } from 'next/server';
import { fetchFeed } from '@/lib/gtfsRealtime';
import { getOpenFeedGap } from '@/lib/ledger';

// myBAS-branded regional feeds - same data.gov.my family as mybas-johor
// (/api/vehicles/johor), just not documented anywhere official. Kangar and
// Kota Bharu are deliberately excluded: their feeds are valid but empty
// stubs (headers only, zero data rows) as of this integration.
const CITY_URLS: Record<string, string> = {
  'alor-setar': 'https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-alor-setar',
  'kuala-terengganu': 'https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-kuala-terengganu',
  'ipoh': 'https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-ipoh',
  'seremban-a': 'https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-seremban-a',
  'seremban-b': 'https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-seremban-b',
  'melaka': 'https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-melaka',
  'kuching': 'https://api.data.gov.my/gtfs-realtime/vehicle-position/mybas-kuching',
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ city: string }> },
) {
  const { city } = await params;
  const url = CITY_URLS[city];

  if (!url) {
    return NextResponse.json(
      {
        vehicles: [],
        stale: false,
        message: `Unknown city "${city}". Supported: ${Object.keys(CITY_URLS).join(', ')}`,
      },
      { status: 400 },
    );
  }

  const network = `mybas-${city}`;
  const { vehicles, stale, fetchedAt, message } = await fetchFeed(url);
  // Zero buses is ambiguous by itself - "genuinely no service right now"
  // and "data.gov.my's feed is down" look identical otherwise.
  const feedGap = vehicles.length === 0 ? await getOpenFeedGap(network) : null;
  return NextResponse.json(
    { vehicles, stale, ...(message ? { message } : {}), ...(feedGap ? { feedGap } : {}) },
    { status: fetchedAt === 0 ? 503 : 200 },
  );
}
