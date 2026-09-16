import { ImageResponse } from 'next/og'
import { fetchLedgerWindow, gradeRows, mytDate, type NetworkGrade } from '@/lib/reliability'
import { gradeColors } from '@/lib/grades'

export const alt = 'Laporan Harian TransitMY - liga kelewatan pengangkutan awam Malaysia'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

/**
 * The share card that does the arguing. League-table rows with big grade
 * stickers, in the poster-plate language: linen canvas, ink borders, one
 * loud lime accent. This image IS the tweet.
 */
export default async function OgImage() {
  let grades: NetworkGrade[] = []
  try {
    grades = gradeRows(await fetchLedgerWindow(7), 7)
  } catch {
    // Render the frame even if the ledger is unreachable.
  }
  const day = mytDate()

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#f3f3f1',
          padding: 48,
          fontFamily: 'sans-serif',
        }}
      >
        {/* Masthead */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: '#ffffff',
              border: '3px solid #000000',
              borderRadius: 99,
              padding: '10px 28px',
              fontSize: 28,
              fontWeight: 700,
              color: '#000000',
              boxShadow: '4px 4px 0 0 #000000',
            }}
          >
            TransitMY
          </div>
          <div
            style={{
              display: 'flex',
              backgroundColor: '#d2e823',
              border: '3px solid #000000',
              borderRadius: 99,
              padding: '10px 24px',
              fontSize: 22,
              fontWeight: 700,
              color: '#000000',
            }}
          >
            {day}
          </div>
        </div>

        {/* Title */}
        <div
          style={{
            display: 'flex',
            marginTop: 28,
            fontSize: 64,
            fontWeight: 800,
            letterSpacing: '-0.03em',
            color: '#000000',
          }}
        >
          Laporan Harian - siapa lambat?
        </div>

        {/* League rows */}
        <div style={{ display: 'flex', flexDirection: 'column', marginTop: 28, gap: 16, flexGrow: 1 }}>
          {grades.slice(0, 3).map((g, i) => {
            const c = gradeColors(g.grade)
            const facts = g.grade === '-'
              ? 'lejar sedang belajar'
              : [
                  `uptime ${g.uptimePct}%`,
                  g.stallCount > 0 ? `${g.stallCount} tren tersekat` : null,
                  g.gapMinutes > 0 ? `${g.gapMinutes} min senyap` : null,
                ].filter(Boolean).join(' · ') || 'bersih'
            return (
              <div
                key={g.network}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  backgroundColor: '#ffffff',
                  border: '3px solid #000000',
                  borderRadius: 24,
                  padding: '18px 28px',
                  boxShadow: '5px 5px 0 0 #000000',
                  gap: 24,
                }}
              >
                <div style={{ display: 'flex', fontSize: 34, fontWeight: 700, color: '#676b5f', width: 40 }}>
                  {i + 1}
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 76,
                    height: 76,
                    backgroundColor: c.bg,
                    color: c.text,
                    border: '3px solid #000000',
                    borderRadius: 20,
                    fontSize: 40,
                    fontWeight: 800,
                  }}
                >
                  {g.grade}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
                  <div style={{ display: 'flex', fontSize: 34, fontWeight: 800, color: '#000000' }}>
                    {g.label}
                  </div>
                  <div style={{ display: 'flex', fontSize: 22, fontWeight: 500, color: '#676b5f' }}>
                    {facts}
                  </div>
                </div>
              </div>
            )
          })}

          {grades.length === 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#ffffff',
                border: '3px solid #000000',
                borderRadius: 24,
                padding: 40,
                fontSize: 30,
                fontWeight: 700,
                color: '#676b5f',
                boxShadow: '5px 5px 0 0 #000000',
              }}
            >
              Lejar baru mula merekod - semak semula esok.
            </div>
          )}
        </div>

        {/* Footer - the honesty line */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 24,
          }}
        >
          <div style={{ display: 'flex', fontSize: 22, fontWeight: 600, color: '#780016' }}>
            LRT/MRT? Prasarana tak siarkan kedudukan tren. Kami gred apa yang mereka tunjuk.
          </div>
          <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: '#676b5f' }}>
            data.gov.my
          </div>
        </div>
      </div>
    ),
    { ...size },
  )
}
