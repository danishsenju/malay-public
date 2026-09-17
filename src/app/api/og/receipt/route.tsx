import { ImageResponse } from 'next/og'

/**
 * Receipt share image - a physical-looking transit ticket. Every frustrated
 * (or smug) commuter becomes a distribution channel; the card is evidence,
 * not just a complaint. Params are user-supplied display strings, so each is
 * length-capped and the colour is validated.
 */

function clean(v: string | null, max: number): string {
  return (v ?? '').replace(/[\r\n]/g, ' ').slice(0, max)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const stop = clean(searchParams.get('stop'), 48) || 'Hentian anda'
  const line = clean(searchParams.get('line'), 32)
  const time = clean(searchParams.get('time'), 5)
  const rawColor = searchParams.get('color') ?? ''
  const color = /^[0-9a-fA-F]{6}$/.test(rawColor) ? `#${rawColor}` : '#2665d6'
  const minsRaw = parseInt(searchParams.get('mins') ?? '', 10)
  const mins = Number.isFinite(minsRaw) ? Math.max(0, Math.min(minsRaw, 999)) : null

  const bigLabel = mins == null ? '- -' : mins <= 0 ? 'TIBA' : `${mins} MIN`

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f3f3f1',
        }}
      >
        {/* The ticket - tilted like a sticker peeled from a sheet */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: 760,
            backgroundColor: '#ffffff',
            border: '4px solid #000000',
            borderRadius: 28,
            boxShadow: '8px 8px 0 0 #000000',
            transform: 'rotate(-1deg)',
            overflow: 'hidden',
          }}
        >
          {/* Header band */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: '#d2e823',
              borderBottom: '4px solid #000000',
              padding: '18px 32px',
            }}
          >
            <div style={{ display: 'flex', fontSize: 30, fontWeight: 800, color: '#000000' }}>
              TransitMY
            </div>
            <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: '#000000' }}>
              RESIT PERJALANAN
            </div>
          </div>

          {/* Body */}
          <div style={{ display: 'flex', flexDirection: 'column', padding: '28px 32px' }}>
            <div style={{ display: 'flex', fontSize: 20, fontWeight: 600, color: '#676b5f', letterSpacing: 2 }}>
              HENTIAN
            </div>
            <div style={{ display: 'flex', fontSize: 44, fontWeight: 800, color: '#000000', letterSpacing: -1 }}>
              {stop}
            </div>

            {line && (
              <div style={{ display: 'flex', marginTop: 14 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    backgroundColor: '#ffffff',
                    border: '3px solid #000000',
                    borderRadius: 99,
                    padding: '6px 18px',
                    fontSize: 22,
                    fontWeight: 700,
                    color: '#000000',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      width: 18,
                      height: 18,
                      borderRadius: 99,
                      border: '2px solid #000000',
                      backgroundColor: color,
                    }}
                  />
                  {line}
                </div>
              </div>
            )}

            {/* Perforation */}
            <div
              style={{
                display: 'flex',
                marginTop: 26,
                borderTop: '4px dashed #00000033',
              }}
            />

            {/* The number */}
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 22 }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', fontSize: 20, fontWeight: 600, color: '#676b5f', letterSpacing: 2 }}>
                  SETERUSNYA DALAM
                </div>
                <div style={{ display: 'flex', fontSize: 96, fontWeight: 800, color: '#000000', letterSpacing: -3 }}>
                  {bigLabel}
                </div>
              </div>
              {time && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', paddingBottom: 14 }}>
                  <div style={{ display: 'flex', fontSize: 20, fontWeight: 600, color: '#676b5f', letterSpacing: 2 }}>
                    DIJADUALKAN
                  </div>
                  <div style={{ display: 'flex', fontSize: 44, fontWeight: 700, color: '#000000' }}>
                    {time}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer: barcode strip */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              borderTop: '4px solid #000000',
              padding: '16px 32px',
              backgroundColor: '#f3f3f1',
            }}
          >
            <div style={{ display: 'flex', gap: 3 }}>
              {[3, 1, 2, 4, 1, 3, 1, 2, 1, 4, 2, 1, 3, 1, 2, 4, 1, 1, 3, 2].map((w, i) => (
                <div key={i} style={{ display: 'flex', width: w * 2, height: 34, backgroundColor: '#000000' }} />
              ))}
            </div>
            <div style={{ display: 'flex', fontSize: 20, fontWeight: 700, color: '#676b5f' }}>
              masa nyata · data.gov.my
            </div>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  )
}
