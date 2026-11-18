import type { Metadata } from 'next'
import { WeatherClient } from '@/components/weather/WeatherClient'
import { fetchFloodFeed } from '@/lib/floodSource'
import { floodShareImagePath, summarizeFlood, hhmmMyt } from '@/lib/floodShare'
import { STATE_BY_CODE, isStateCode } from '@/lib/flood'
import { requestOrigin } from '@/lib/origin'
import { STRINGS } from '@/lib/strings'

const DEFAULT_TITLE = 'Cuaca & Banjir - TransitMY'
const DEFAULT_DESCRIPTION =
  'Paras sungai & hujan langsung dari stesen telemetri JPS, ramalan 7 hari & amaran MET Malaysia - dengan amaran banjir ke telefon. Tiada login.'

/**
 * A shared flood link (?state=KEL or ?station=ID) unfurls in WhatsApp as the
 * live river card: title and image are drawn from the JPS feed at request time.
 * A plain /weather keeps the generic tags.
 */
export async function generateMetadata(
  { searchParams }: { searchParams: Promise<{ state?: string; station?: string; lang?: string }> },
): Promise<Metadata> {
  const sp = await searchParams
  const state = isStateCode(sp.state) ? sp.state : null
  const station = sp.station?.slice(0, 40) ?? null
  const lang = sp.lang === 'en' ? 'en' : 'ms'
  const base: Metadata = { title: DEFAULT_TITLE, description: DEFAULT_DESCRIPTION }
  if (!state && !station) return base

  try {
    const feed = await fetchFloodFeed()
    const s = STRINGS[lang]
    const time = hhmmMyt(feed.sourceUpdatedAt)
    const image = floodShareImagePath({ state, station, lang })

    let title: string
    let description: string
    const st = station ? feed.stations.find(x => x.id === station) : undefined
    if (station && st && st.level && st.waterLevelM != null) {
      const place = [st.district, STATE_BY_CODE.get(st.state)?.name].filter(Boolean).join(', ')
      title = `${st.name}: ${s[`wx.level.${st.level}` as const]} ${st.waterLevelM.toFixed(2)} m`
      description = `${place} · JPS ${time} MYT. ${s['og.flood.liveLink']}.`
    } else {
      const sum = summarizeFlood(feed.stations, state, feed.sourceUpdatedAt)
      const parts = (['danger', 'warning', 'alert'] as const)
        .filter(l => sum[l] > 0)
        .map(l => `${sum[l]} ${s[`wx.level.${l}` as const]}`)
      title = parts.length > 0 ? `${s['og.flood.eyebrow']} ${sum.scopeName}: ${parts.join(' · ')}` : `${s['og.flood.calm']} · ${sum.scopeName}`
      description = `JPS ${time} MYT. ${s['og.flood.liveLink']}.`
    }

    return {
      // Absolute, public og:image URL - see lib/origin.ts.
      metadataBase: new URL(await requestOrigin()),
      title: `${title} · TransitMY`,
      description,
      openGraph: { title, description, siteName: 'TransitMY', type: 'article', images: [{ url: image, width: 1200, height: 630, alt: title }] },
      twitter: { card: 'summary_large_image', title, description, images: [image] },
    }
  } catch {
    // JPS unreachable: still a valid link, just without the live card.
    return base
  }
}

export default function WeatherPage() {
  return <WeatherClient />
}
