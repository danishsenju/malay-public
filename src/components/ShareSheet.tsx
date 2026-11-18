'use client'

import { useState, type ReactNode } from 'react'
import { Drawer } from 'vaul'
import { useLang } from '@/lib/i18n'

/**
 * One Share button that reaches ANY platform.
 *
 *  - Touch devices (phones, tablets): the OS share sheet - whatever the person
 *    has installed shows up in it (WhatsApp, Telegram, Threads, X, Messenger,
 *    Instagram, Mail, AirDrop, ...). We can't list apps we can't see, and we
 *    shouldn't try.
 *  - Desktop (and when the OS sheet is unavailable or fails): our own sheet
 *    with the platforms that publish a web share link, plus copy and "save
 *    image". Instagram and TikTok have no web share link at all, so the saved
 *    card image is how a flood update reaches a story or a post.
 *
 * Chosen by capability (`pointer: coarse` + navigator.share), never by sniffing
 * the user agent. Web Share also exists in desktop Chrome/Edge on Windows, but
 * that sheet is a thin one; the desktop sheet below is more useful there.
 *
 * `text` carries the message WITHOUT the link; `url` is passed separately so
 * the OS sheet doesn't print the link twice. Channels that take a single
 * string get `text + "\n" + url`.
 */

interface ShareSheetProps {
  title: string
  text: string
  url: string
  /** Same-origin path of the preview card; offered as "Save image". */
  imagePath?: string
  imageName?: string
  label: string
  compact?: boolean
  className?: string
}

const ENC = encodeURIComponent

const stroke = {
  fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
} as const

const ICON = {
  share: 'M7.2 10.9a2.25 2.25 0 1 0 0 2.2m0-2.2c.2.3.3.7.3 1.1s-.1.8-.3 1.1m0-2.2 9.6-5.3m-9.6 7.5 9.6 5.3m0 0a2.25 2.25 0 1 0 3.9 2.2 2.25 2.25 0 0 0-3.9-2.2zm0-12.8a2.25 2.25 0 1 0 3.9-2.2 2.25 2.25 0 0 0-3.9 2.2z',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  message: 'M4 6.5h16M4 12h16M4 17.5h10',
  whatsapp: 'M20.5 11.5A8.5 8.5 0 0 1 8.4 19.1L3.5 20.5l1.4-4.7A8.5 8.5 0 1 1 20.5 11.5zM9.2 8.6c.4 2.3 2.4 4.3 4.7 4.7l1.1-1.1-1.8-1-.7.6a3.6 3.6 0 0 1-1.5-1.5l.6-.7-1-1.8-1.4 1.8z',
  telegram: 'M21 3 3 10.5l6 2.5 2.5 6L21 3zM9 13l5-4',
  x: 'M5 5l14 14M19 5 5 19',
  facebook: 'M14.5 8H17V4.5h-2.7A3.8 3.8 0 0 0 10.5 8.3V11H8v3.5h2.5V20H14v-5.5h2.6l.5-3.5H14V8.6c0-.4.2-.6.5-.6z',
  threads: 'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM16 12v1.5a2.5 2.5 0 0 0 5 0V12a9 9 0 1 0-3.6 7.2',
  mail: 'M4 6h16v12H4V6zm0 0 8 7 8-7',
  image: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
} as const

function Icon({ d }: { d: string }) {
  return (
    <svg aria-hidden className="h-18 w-18" viewBox="0 0 24 24" {...stroke}>
      <path d={d} />
    </svg>
  )
}

const tile =
  'plate pressable-gpu flex w-full items-center gap-10 rounded-2xl px-14 py-10 text-left font-sans text-body-sm font-bold text-ink-black'

function Sticker({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border-2 border-ink-black bg-leaf-wash text-ink-black">
      {children}
    </span>
  )
}

function prefersNativeShare(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  )
}

export function ShareSheet({ title, text, url, imagePath, imageName, label, compact = false, className = '' }: ShareSheetProps) {
  const { t } = useLang()
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState<'link' | 'message' | null>(null)

  const full = `${text}\n${url}`

  async function onShare() {
    if (prefersNativeShare()) {
      try {
        await navigator.share({ title, text, url })
        return
      } catch (err) {
        // Dismissing the sheet is an answer, not a failure.
        if (err instanceof DOMException && err.name === 'AbortError') return
        // Anything else (blocked, unsupported payload): fall through to ours.
      }
    }
    setOpen(true)
  }

  async function copy(what: 'link' | 'message') {
    try {
      await navigator.clipboard.writeText(what === 'link' ? url : full)
      setCopied(what)
      setTimeout(() => setCopied(null), 1800)
    } catch {
      // Clipboard blocked: the other channels still work.
    }
  }

  const channels: { id: string; label: string; href: string; icon: string }[] = [
    { id: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${ENC(full)}`, icon: ICON.whatsapp },
    { id: 'telegram', label: 'Telegram', href: `https://t.me/share/url?url=${ENC(url)}&text=${ENC(text)}`, icon: ICON.telegram },
    { id: 'x', label: 'X', href: `https://x.com/intent/post?text=${ENC(text)}&url=${ENC(url)}`, icon: ICON.x },
    { id: 'facebook', label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${ENC(url)}`, icon: ICON.facebook },
    { id: 'threads', label: 'Threads', href: `https://www.threads.net/intent/post?text=${ENC(full)}`, icon: ICON.threads },
    { id: 'email', label: t('share.email'), href: `mailto:?subject=${ENC(title)}&body=${ENC(full)}`, icon: ICON.mail },
  ]

  return (
    <>
      <button
        type="button"
        onClick={onShare}
        className={`plate pressable-gpu inline-flex items-center justify-center gap-8 rounded-full-2 bg-lime-spark font-sans font-bold text-ink-black ${
          compact ? 'px-18 py-8 text-caption' : 'px-18 py-10 text-body-sm'
        } ${className}`}
      >
        <svg aria-hidden className="h-18 w-18 shrink-0" viewBox="0 0 24 24" {...stroke}><path d={ICON.share} /></svg>
        {label}
      </button>

      <Drawer.Root open={open} onOpenChange={setOpen} noBodyStyles>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 z-60 bg-ink-black/40" />
          <Drawer.Content
            className="fixed inset-x-0 bottom-0 z-60 flex flex-col rounded-t-3xl-2 border-t-2 border-ink-black bg-linen-canvas p-20 outline-none"
            style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
          >
            <Drawer.Handle className="mx-auto mb-14 mt-0 h-4 w-40 shrink-0 rounded-full-3 bg-ink-black/20" />
            <div className="mx-auto w-full max-w-md">
              <Drawer.Title className="font-sans text-[19px] font-extrabold leading-snug tracking-[-0.02em] text-ink-black">
                {t('share.sheet.title')}
              </Drawer.Title>
              <Drawer.Description className="mt-4 font-sans text-caption text-sage-mute">
                {t('share.sheet.desc')}
              </Drawer.Description>

              <div className="mt-16 grid grid-cols-2 gap-10">
                {channels.map(c => (
                  <a key={c.id} href={c.href} target="_blank" rel="noopener noreferrer" className={tile}>
                    <Sticker><Icon d={c.icon} /></Sticker>
                    {c.label}
                  </a>
                ))}
                <button type="button" onClick={() => copy('link')} className={tile}>
                  <Sticker><Icon d={ICON.link} /></Sticker>
                  {copied === 'link' ? t('share.copied') : t('share.copyLink')}
                </button>
                <button type="button" onClick={() => copy('message')} className={tile}>
                  <Sticker><Icon d={ICON.message} /></Sticker>
                  {copied === 'message' ? t('share.copied') : t('share.copyMessage')}
                </button>
              </div>

              {imagePath && (
                // The only route to Instagram / TikTok / stories: they have no
                // web share link, but they all accept an image.
                <a href={imagePath} download={`${imageName ?? 'transitmy'}.png`} className={`${tile} mt-10 bg-lime-spark`}>
                  <Sticker><Icon d={ICON.image} /></Sticker>
                  <span className="min-w-0">
                    <span className="block">{t('share.saveImage')}</span>
                    <span className="block font-mono text-[10px] font-medium text-ink-black/70">{t('share.saveImageHint')}</span>
                  </span>
                </a>
              )}

              <button
                type="button"
                onClick={() => setOpen(false)}
                className="pressable mt-16 w-full rounded-full-2 border-2 border-ink-black bg-white-plate py-10 font-sans text-body-sm font-bold text-ink-black"
              >
                {t('share.close')}
              </button>
            </div>
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    </>
  )
}
