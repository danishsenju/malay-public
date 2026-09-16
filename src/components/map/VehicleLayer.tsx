'use client'

import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import type { MapVehicle } from '@/lib/map'
import { vehicleColor, vehicleLabel } from '@/lib/map'

// How long a dot takes to glide from its previous position to the newly-reported
// one. This is on-screen movement, so ease-in-out (per the motion skill). It's
// deliberately longer than a UI micro-interaction - it represents a physical
// vehicle moving, not a control responding.
const TWEEN_MS = 1500
const FADE_MS = 340 // must match .veh-marker opacity transition in globals.css

type LatLon = [number, number]

interface Entry {
  marker: L.Marker
  from: LatLon
  to: LatLon
  cur: LatLon
  start: number
  removeTimer?: ReturnType<typeof setTimeout>
}

function easeInOut(t: number): number {
  // cubic-bezier-ish symmetric ease (matches --ease-in-out intent)
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

/** Tooltip text with the GPS report's age - radical transparency: every dot
 *  says exactly how fresh its position is. */
function tooltipText(v: MapVehicle): string {
  const label = vehicleLabel(v)
  if (!v.timestampMs) return label
  const ageS = Math.max(0, Math.round((Date.now() - v.timestampMs) / 1000))
  return ageS < 120 ? `${label} · ${ageS}s` : `${label} · ${Math.round(ageS / 60)} min`
}

function makeIcon(v: MapVehicle): L.DivIcon {
  const color = vehicleColor(v.id)
  const label = escapeHtml(vehicleLabel(v))
  return L.divIcon({
    className: 'veh-marker',
    html:
      `<div class="veh-marker-inner">` +
      `<div class="veh-dot" style="background:${color}"></div>` +
      `<div class="veh-label">${label}</div>` +
      `</div>`,
    iconSize: [44, 30],
    iconAnchor: [22, 7], // dot centre sits on the reported coordinate
  })
}

/**
 * Imperative layer that plots live vehicle dots and animates them.
 * - New vehicles fade in (opacity only).
 * - Moved vehicles glide to their new position via a rAF tween.
 * - Vehicles that drop out of the feed fade out, then are removed - never left
 *   frozen as a stale dot (DESIGN.md honesty principle, opacity-only, no blur).
 */
export function VehicleLayer({ vehicles }: { vehicles: MapVehicle[] }) {
  const map = useMap()
  const entries = useRef<Map<string, Entry>>(new Map())
  const rafRef = useRef<number | null>(null)

  // Reconcile the marker set whenever new data arrives.
  useEffect(() => {
    const now = performance.now()
    const seen = new Set<string>()

    for (const v of vehicles) {
      seen.add(v.id)
      const to: LatLon = [v.lat, v.lon]
      const existing = entries.current.get(v.id)

      if (existing) {
        // Cancel any pending removal - it's back in the feed.
        if (existing.removeTimer) {
          clearTimeout(existing.removeTimer)
          existing.removeTimer = undefined
          const el = existing.marker.getElement()
          if (el) el.dataset.shown = '1'
        }
        // Retarget the tween from wherever the dot currently sits.
        existing.from = existing.cur
        existing.to = to
        existing.start = now
        existing.marker.setTooltipContent(tooltipText(v))
      } else {
        const marker = L.marker(to, { icon: makeIcon(v), interactive: true, keyboard: false })
          .bindTooltip(tooltipText(v), { direction: 'top', offset: [0, -6], opacity: 1 })
          .addTo(map)
        const entry: Entry = { marker, from: to, to, cur: to, start: now }
        entries.current.set(v.id, entry)
        // Fade in on the next frame so the opacity transition runs.
        requestAnimationFrame(() => {
          const el = marker.getElement()
          if (el) el.dataset.shown = '1'
        })
      }
    }

    // Fade out anything no longer reported.
    for (const [id, entry] of entries.current) {
      if (seen.has(id) || entry.removeTimer) continue
      const el = entry.marker.getElement()
      if (el) el.dataset.shown = '0'
      entry.removeTimer = setTimeout(() => {
        map.removeLayer(entry.marker)
        entries.current.delete(id)
      }, FADE_MS)
    }
  }, [vehicles, map])

  // Single rAF loop drives every dot's position tween.
  useEffect(() => {
    const tick = () => {
      const now = performance.now()
      for (const entry of entries.current.values()) {
        const t = Math.min(1, (now - entry.start) / TWEEN_MS)
        const e = easeInOut(t)
        entry.cur = [lerp(entry.from[0], entry.to[0], e), lerp(entry.from[1], entry.to[1], e)]
        entry.marker.setLatLng(entry.cur)
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  // Tear down all markers on unmount / network switch.
  useEffect(() => {
    const store = entries.current
    return () => {
      for (const entry of store.values()) {
        if (entry.removeTimer) clearTimeout(entry.removeTimer)
        map.removeLayer(entry.marker)
      }
      store.clear()
    }
  }, [map])

  return null
}
