'use client'

import { useState } from 'react'

interface ShareButtonProps {
  title: string
  text:  string
  /** Absolute or path URL to share; defaults to the current page. */
  url?:  string
  className?: string
}

/**
 * One-tap share → the OS share sheet (Threads/X/WhatsApp) with clipboard
 * fallback. The morphing label is state indication: "Disalin!" confirms the
 * fallback actually happened.
 */
export function ShareButton({ title, text, url, className }: ShareButtonProps) {
  const [copied, setCopied] = useState(false)

  async function handleShare() {
    const shareUrl = url ?? window.location.href
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url: shareUrl })
        return
      } catch {
        // User dismissed the sheet - do nothing.
        return
      }
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${shareUrl}`)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard blocked - silently degrade.
    }
  }

  return (
    <button
      type="button"
      onClick={handleShare}
      className={`
        plate pressable flex items-center justify-center gap-8 rounded-full-2
        bg-lime-spark px-20 py-10 font-sans text-[15px] font-bold text-ink-black
        ${className ?? ''}
      `}
    >
      <svg aria-hidden className="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.25}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0 0a2.25 2.25 0 1 0 3.935 2.186 2.25 2.25 0 0 0-3.935-2.186Zm0-12.814a2.25 2.25 0 1 0 3.933-2.185 2.25 2.25 0 0 0-3.933 2.185Z" />
      </svg>
      {copied ? 'Disalin!' : 'Kongsi'}
    </button>
  )
}
