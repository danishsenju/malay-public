import { ImageResponse } from 'next/og';
import { fetchFloodFeed } from '@/lib/floodSource';
import { summarizeFlood, hhmmMyt } from '@/lib/floodShare';
import { LEVEL_STYLE, STATE_BY_CODE, isStateCode, type FloodLevel, type FloodStation } from '@/lib/flood';
import { STRINGS, type StringKey } from '@/lib/strings';

/**
 * Flood share card - what WhatsApp / Threads / X unfurl for a /weather?tab=banjir
 * link. Two shapes, picked by the query:
 *   ?state=KEL   a state's river summary (omit for all Malaysia)
 *   ?station=ID  one river station
 * Everything is read from the JPS feed at request time; the URL carries only
 * the state/station and the language. Cached for 5 minutes (JPS posts every
 * 15), and the card always prints the JPS time it was drawn from - a stale
 * screenshot of a river level is a liability, so the time is part of the image
 * and the link underneath is live.
 */

const INK = '#000000';
const LINEN = '#f3f3f1';
const SAGE = '#676b5f';
const LIME = '#d2e823';
const FOREST = '#254f1a';

function bandFor(danger: number, warning: number, alert: number): { bg: string; text: string } {
  if (danger > 0) return LEVEL_STYLE.danger;
  if (warning > 0) return LEVEL_STYLE.warning;
  if (alert > 0) return LEVEL_STYLE.alert;
  return { bg: FOREST, text: '#ffffff' };
}

function Label({ children }: { children: string }) {
  return (
    <div style={{ display: 'flex', fontSize: 18, fontWeight: 700, color: SAGE, letterSpacing: 2 }}>
      {children.toUpperCase()}
    </div>
  );
}

function Frame({
  band, bandTitle, children, footer, host, promo,
}: { band: { bg: string; text: string }; bandTitle: string; children: React.ReactNode; footer: string; host: string; promo: string }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: LINEN }}>
      <div
        style={{
          display: 'flex', flexDirection: 'column', width: 1080, backgroundColor: '#ffffff',
          border: `4px solid ${INK}`, borderRadius: 28, boxShadow: `10px 10px 0 0 ${INK}`, overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            backgroundColor: band.bg, borderBottom: `4px solid ${INK}`, padding: '18px 36px',
          }}
        >
          <div style={{ display: 'flex', fontSize: 26, fontWeight: 800, color: band.text, letterSpacing: 3 }}>
            {bandTitle.toUpperCase()}
          </div>
          <div style={{ display: 'flex', fontSize: 26, fontWeight: 800, color: band.text }}>TransitMY</div>
        </div>
        {children}
        <div
          style={{
            display: 'flex', margin: '0 36px', padding: '14px 0 18px', borderTop: '3px dashed rgba(0,0,0,0.2)',
            fontSize: 19, fontWeight: 700, color: INK,
          }}
        >
          {footer}
        </div>
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            backgroundColor: LIME, borderTop: `4px solid ${INK}`, padding: '16px 36px',
          }}
        >
          <div style={{ display: 'flex', fontSize: 24, fontWeight: 800, color: INK }}>{host}</div>
          <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: INK }}>{promo}</div>
        </div>
      </div>
    </div>
  );
}

function Sticker({ level, label }: { level: FloodLevel; label: string }) {
  const c = LEVEL_STYLE[level];
  return (
    <div
      style={{
        display: 'flex', fontSize: 22, fontWeight: 800, letterSpacing: 2, color: c.text, backgroundColor: c.bg,
        border: `3px solid ${INK}`, borderRadius: 99, padding: '4px 18px',
      }}
    >
      {label.toUpperCase()}
    </div>
  );
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'ms';
  const stationId = url.searchParams.get('station');
  const stateParam = url.searchParams.get('state');
  const state = isStateCode(stateParam) ? stateParam : null;
  const s = STRINGS[lang];
  const host = url.host;
  const promo = s['alasan.promo'];

  const feed = await fetchFloodFeed();
  const headers = { 'Cache-Control': 'public, max-age=120, s-maxage=300, stale-while-revalidate=600' };
  const size = { width: 1200, height: 630, headers };
  const updated = hhmmMyt(feed.sourceUpdatedAt);
  const footer = `${s['og.flood.snapshot']} ${updated} MYT · JPS InfoBanjir · ${s['og.flood.liveLink']}`;

  // ── One station ──
  if (stationId) {
    const st: FloodStation | undefined = feed.stations.find(x => x.id === stationId);
    if (!st || st.level == null) return new Response('Not found', { status: 404 });
    const band = LEVEL_STYLE[st.level];
    const place = [st.river, st.district, STATE_BY_CODE.get(st.state)?.name].filter(Boolean).join(' · ');
    const trend = st.trend ? `${st.trend === 'rising' ? '↑' : st.trend === 'falling' ? '↓' : '→'} ${s[`wx.trend.${st.trend}` as StringKey]}` : '';
    return new ImageResponse(
      (
        <Frame band={band} bandTitle={s['og.flood.eyebrow']} footer={footer} host={host} promo={promo}>
          <div style={{ display: 'flex', flexDirection: 'column', padding: '28px 36px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Sticker level={st.level} label={s[`wx.level.${st.level}` as StringKey]} />
              <div style={{ display: 'flex', fontSize: 22, fontWeight: 700, color: SAGE }}>{place}</div>
            </div>
            <div style={{ display: 'flex', marginTop: 14, fontSize: 54, fontWeight: 800, color: INK, letterSpacing: -1.5 }}>
              {st.name}
            </div>
            {st.waterLevelM != null && (
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 36, marginTop: 20 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, color: INK }}>
                  <div style={{ display: 'flex', fontSize: 130, fontWeight: 800, letterSpacing: -5, lineHeight: 1 }}>
                    {st.waterLevelM.toFixed(2)}
                  </div>
                  <div style={{ display: 'flex', fontSize: 40, fontWeight: 800 }}>m</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', paddingBottom: 14 }}>
                  {st.thresholdM != null && (
                    <>
                      <Label>{s['og.flood.threshold']}</Label>
                      <div style={{ display: 'flex', fontSize: 38, fontWeight: 800, color: INK }}>{`${st.thresholdM.toFixed(2)} m`}</div>
                    </>
                  )}
                  {trend && <div style={{ display: 'flex', marginTop: 6, fontSize: 28, fontWeight: 800, color: INK }}>{trend}</div>}
                </div>
              </div>
            )}
          </div>
        </Frame>
      ),
      size,
    );
  }

  // ── A state, or all of Malaysia ──
  const sum = summarizeFlood(feed.stations, state, feed.sourceUpdatedAt);
  const band = bandFor(sum.danger, sum.warning, sum.alert);
  const calm = sum.danger + sum.warning + sum.alert === 0;
  const tiles = (['danger', 'warning', 'alert'] as const).map(l => ({
    level: l, n: sum[l], label: s[`wx.level.${l}` as StringKey],
  }));

  return new ImageResponse(
    (
      <Frame band={band} bandTitle={`${s['og.flood.eyebrow']} · ${sum.scopeName}`} footer={footer} host={host} promo={promo}>
        <div style={{ display: 'flex', padding: '26px 36px 22px', gap: 28 }}>
          <div style={{ display: 'flex', gap: 14 }}>
            {tiles.map(tile => {
              const c = LEVEL_STYLE[tile.level];
              const lit = tile.n > 0;
              return (
                <div
                  key={tile.level}
                  style={{
                    display: 'flex', flexDirection: 'column', justifyContent: 'space-between', width: 150, height: 190,
                    padding: '14px 16px', border: `4px solid ${INK}`, borderRadius: 22,
                    backgroundColor: lit ? c.bg : '#ffffff', color: lit ? c.text : SAGE,
                  }}
                >
                  <div style={{ display: 'flex', fontSize: 96, fontWeight: 800, letterSpacing: -4, lineHeight: 1 }}>{tile.n}</div>
                  <div style={{ display: 'flex', fontSize: 20, fontWeight: 800, letterSpacing: 2 }}>{tile.label.toUpperCase()}</div>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
            {calm ? (
              <div style={{ display: 'flex', fontSize: 40, fontWeight: 800, color: FOREST }}>{s['og.flood.calm']}</div>
            ) : (
              sum.top.map(r => (
                <div
                  key={r.id}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '2px dashed rgba(0,0,0,0.15)' }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', width: 330 }}>
                    <div style={{ display: 'flex', fontSize: 24, fontWeight: 800, color: INK }}>{r.name.length > 30 ? `${r.name.slice(0, 29)}…` : r.name}</div>
                    <div style={{ display: 'flex', fontSize: 17, fontWeight: 600, color: SAGE }}>{r.district}</div>
                  </div>
                  <div style={{ display: 'flex', fontSize: 30, fontWeight: 800, color: INK }}>
                    {r.waterLevelM != null ? `${r.waterLevelM.toFixed(2)} m` : ''}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </Frame>
    ),
    size,
  );
}
