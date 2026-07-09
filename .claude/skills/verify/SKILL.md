---
name: verify
description: How to runtime-verify TransitMY (Next.js PWA) changes on this machine — launch, drive with CDP, and the flows worth exercising.
---

# Verifying TransitMY

## Launch

- A dev server is usually ALREADY running on port 3000 (the user's own). It
  serves this same directory with Turbopack hot reload, so just drive
  `http://localhost:3000` — do NOT kill it, and don't start a second server
  (it will fail with "Another next dev server is already running").
- `npm run build` for compile/type safety, `npm run lint` for ESLint
  (react-hooks/set-state-in-effect is enforced — no sync setState in effects).

## Drive (CDP over ws — no Playwright/puppeteer installed)

1. Launch headless Chrome with its own profile:
   `& "C:\Program Files\Google\Chrome\Application\chrome.exe" --headless=new --remote-debugging-port=9333 --user-data-dir=<scratch>\chrome-profile --no-first-run about:blank`
2. Node script imports `ws` from THIS project's node_modules via
   `createRequire('C:/Users/danis/MyProject/malay-public/package.json')`
   (scripts in the scratchpad can't resolve it otherwise).
3. Connect to `webSocketDebuggerUrl` from `http://127.0.0.1:9333/json/version`,
   then: `Target.createTarget` → `Target.attachToTarget {flatten:true}` →
   session-scoped `Page.enable`, `Runtime.enable`,
   `Emulation.setDeviceMetricsOverride` (390×844 mobile),
   `Browser.grantPermissions {permissions:['geolocation']}` (browser-level, no
   sessionId), `Emulation.setGeolocationOverride`.
4. Reusable driver from a past session:
   scratchpad `cdp.mjs` pattern — `Runtime.evaluate {returnByValue, awaitPromise}`
   to click buttons / read DOM, `Page.captureScreenshot` for evidence.
5. To set React inputs (SearchOverlay), use the native value setter +
   `dispatchEvent(new Event('input', {bubbles:true}))`.

## Useful coordinates & selectors

- KLCC (dense stops): 3.1579, 101.7123 · KL Sentral: 3.1343, 101.6865 ·
  Far-from-stops: 3.2105, 101.8310 (Hulu Langat, nearest stops ~3.2 km).
- Arrival cards: `button[aria-label*="minit"]`; flap board text is inside
  `[class*="text-[42px]"]`.
- Map vehicle dots: `.veh-marker` / labels `.veh-label`; map network tabs are
  buttons "KTM" / "Rapid KL Bus"; locate button `aria-label="Lokasi saya"`.
- Saved stops localStorage key: `sampai-bila:saved`.
- Live countdown check: snapshot flap texts, wait ~75s, snapshot again —
  minutes must decrease / rows expire.

## Gotchas

- This machine reports `prefers-reduced-motion: reduce` — animations are
  near-instant; don't diagnose "broken animation" from that.
- Live feeds are real (data.gov.my): KTM has few trains late at night; bus
  headsigns are often `—` (missing trip_headsign upstream) — data gaps, not
  bugs.
