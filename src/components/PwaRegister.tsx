'use client'

import { useEffect } from 'react'

/** Registers the offline service worker once per app load. Renders nothing. */
export function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    // Registration is deliberately fire-and-forget: offline support is an
    // enhancement, never a blocker.
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])

  return null
}
