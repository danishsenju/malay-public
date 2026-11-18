import { ImageResponse } from 'next/og'
import { fetchDisruption } from '@/lib/disruptions'
import { disruptionCopy } from '@/lib/disruptionCopy'
import { STRINGS } from '@/lib/strings'

/**
 * Disruption record preview - the image WhatsApp / Threads / X unfurl for an
 * /alasan/[id] link. Everything on it is read from the ledger row by id; the
 * URL carries only the id and the language, so a card can't be doctored by
 * editing query params (unlike a free-text receipt).
 *
 * Deliberately straight, not tilted like the trip receipt: this one is meant
 * to be read as a record. Still the poster language - ink frame, hard offset
 * shadow, maroon band for a disruption, lime strip that sells the app.
 */

const INK = '#000000'
const LINEN = '#f3f3f1'
const MAROON = '#780016'
const LIME = '#d2e823'
const SAGE = '#676b5f'

function Label({ children }: { children: string }) {
  return (
    <div style={{ display: 'flex', fontSize: 18, fontWeight: 700, color: SAGE, letterSpacing: 2 }}>
      {children.toUpperCase()}
    </div>
  )
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const id = parseInt(url.searchParams.get('id') ?? '', 10)
  const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'ms'
  const d = await fetchDisruption(id)
  if (!d) return new Response('Not found', { status: 404 })

  const c = disruptionCopy(d, lang)
  const s = STRINGS[lang]
  const host = url.host

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: LINEN }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: 1080,
            backgroundColor: '#ffffff',
            border: `4px solid ${INK}`,
            borderRadius: 28,
            boxShadow: `10px 10px 0 0 ${INK}`,
            overflow: 'hidden',
          }}
        >
          {/* Band: what this is + who recorded it */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: MAROON,
              borderBottom: `4px solid ${INK}`,
              padding: '18px 36px',
            }}
          >
            <div style={{ display: 'flex', fontSize: 24, fontWeight: 800, color: '#ffffff', letterSpacing: 3 }}>
              {c.title.toUpperCase()}
            </div>
            <div style={{ display: 'flex', fontSize: 26, fontWeight: 800, color: LIME }}>TransitMY</div>
          </div>

          {/* Body: facts left, the number right */}
          <div style={{ display: 'flex', padding: '30px 36px 26px', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', flexDirection: 'column', width: 640 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ display: 'flex', fontSize: 50, fontWeight: 800, color: INK, letterSpacing: -1.5 }}>
                  {c.network}
                </div>
                {(c.route ?? c.vehicle) && (
                  <div
                    style={{
                      display: 'flex',
                      fontSize: 24,
                      fontWeight: 800,
                      color: INK,
                      border: `3px solid ${INK}`,
                      borderRadius: 10,
                      padding: '2px 12px',
                      backgroundColor: LINEN,
                    }}
                  >
                    {c.route ?? c.vehicle}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', marginTop: 6, fontSize: 32, fontWeight: 700, color: MAROON }}>
                {c.headline}
              </div>

              <div style={{ display: 'flex', marginTop: 30, gap: 48 }}>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <Label>{s['alasan.date']}</Label>
                  <div style={{ display: 'flex', marginTop: 4, fontSize: 30, fontWeight: 700, color: INK }}>{c.date}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <Label>{s['alasan.time']}</Label>
                  <div style={{ display: 'flex', marginTop: 4, fontSize: 30, fontWeight: 700, color: INK }}>
                    {`${c.start} – ${c.end}`}
                  </div>
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                width: 300,
                border: `4px solid ${INK}`,
                borderRadius: 22,
                backgroundColor: LINEN,
                padding: '14px 0',
              }}
            >
              <Label>{s['alasan.duration']}</Label>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, color: INK }}>
                <div style={{ display: 'flex', fontSize: 120, fontWeight: 800, letterSpacing: -5, lineHeight: 1 }}>
                  {String(Math.min(c.minutes, 999))}
                </div>
                <div style={{ display: 'flex', fontSize: 34, fontWeight: 800 }}>MIN</div>
              </div>
              {c.ongoing && (
                <div style={{ display: 'flex', fontSize: 20, fontWeight: 700, color: MAROON }}>{c.end}</div>
              )}
            </div>
          </div>

          {/* Provenance */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              borderTop: `3px dashed rgba(0,0,0,0.2)`,
              margin: '0 36px',
              padding: '14px 0 18px',
              fontSize: 19,
              fontWeight: 600,
              color: SAGE,
            }}
          >
            <div style={{ display: 'flex' }}>{c.source}</div>
            <div style={{ display: 'flex' }}>{`${s['alasan.record']} #${d.id}`}</div>
          </div>

          {/* What this is - and isn't. On the image itself, because a screenshot
              of the card travels without the page's explanation. */}
          <div
            style={{
              display: 'flex',
              margin: '0 36px',
              paddingBottom: 18,
              fontSize: 20,
              fontWeight: 700,
              color: INK,
            }}
          >
            {c.scopeShort}
          </div>

          {/* The app, sold in one line */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: LIME,
              borderTop: `4px solid ${INK}`,
              padding: '16px 36px',
            }}
          >
            <div style={{ display: 'flex', fontSize: 24, fontWeight: 800, color: INK }}>{host}</div>
            <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: INK }}>{s['alasan.promo']}</div>
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        // An ended record never changes; an open one ticks every minute.
        'Cache-Control': d.endedAt
          ? 'public, max-age=86400, s-maxage=604800, immutable'
          : 'public, max-age=60, s-maxage=60',
      },
    },
  )
}
