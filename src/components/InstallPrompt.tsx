'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Drawer } from 'vaul'
import { useLang } from '@/lib/i18n'

/**
 * "Add to home screen" prompt - PWA install has no universal one-tap API.
 * Android Chrome fires `beforeinstallprompt`, so we capture it and offer a
 * real one-tap install. Every other mobile browser (iOS Safari above all -
 * Apple never exposes a programmatic install hook) gets a step-by-step guide
 * instead, matched to the platform actually detected.
 *
 * Shown once per browser: dismissing (either "later" on the banner, or
 * finishing/closing the guide) sets a localStorage flag that suppresses it
 * for good - this is a convenience nudge, never a nag.
 */

const DISMISS_KEY = 'transitmy:install-dismissed'

type Platform = 'ios' | 'android' | 'other'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function detectPlatform(): Platform {
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'other'
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

// Client-only eligibility check (platform + already-installed + previously
// dismissed), computed once and cached - matches the useSyncExternalStore
// pattern used elsewhere in this codebase (HomeLayout's clock, useSavedStops'
// hydration flag) to read browser-only APIs without a setState-in-effect.
interface EligibilityState { platform: Platform; eligible: boolean }
let cachedEligibility: EligibilityState | null = null
function getEligibilitySnapshot(): EligibilityState {
  if (cachedEligibility) return cachedEligibility
  const platform = detectPlatform()
  const dismissed = (() => {
    try { return localStorage.getItem(DISMISS_KEY) === '1' } catch { return false }
  })()
  cachedEligibility = { platform, eligible: platform !== 'other' && !isStandalone() && !dismissed }
  return cachedEligibility
}
// A fresh object literal here would violate useSyncExternalStore's contract
// (getServerSnapshot must return a referentially stable value across calls) -
// React detects the "changed" reference every render and warns "should be
// cached to avoid an infinite loop", which destabilizes renders app-wide.
const SERVER_ELIGIBILITY: EligibilityState = { platform: 'other', eligible: false }
function getServerEligibility(): EligibilityState {
  return SERVER_ELIGIBILITY
}
const emptySubscribe = () => () => {}

function ShareIcon() {
  return (
    <svg aria-hidden className="h-20 w-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="M8 7l4-4 4 4" />
      <rect x="5" y="10" width="14" height="11" rx="2" />
    </svg>
  )
}

function KebabMenuIcon() {
  return (
    <svg aria-hidden className="h-20 w-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="19" r="1.4" fill="currentColor" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg aria-hidden className="h-20 w-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

function PlusSquareIcon() {
  return (
    <svg aria-hidden className="h-20 w-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  )
}

function GuideStep({ index, icon, text }: { index: number; icon: React.ReactNode; text: string }) {
  return (
    <li className="flex items-center gap-14">
      <span className="flex h-40 w-40 shrink-0 items-center justify-center rounded-full-3 border-2 border-ink-black bg-white-plate font-mono text-body-sm font-bold text-ink-black">
        {index}
      </span>
      <span className="flex h-40 w-40 shrink-0 items-center justify-center rounded-lg border-2 border-ink-black bg-leaf-wash text-ink-black">
        {icon}
      </span>
      <span className="min-w-0 flex-1 font-sans text-body-sm leading-snug text-ink-black">
        {text}
      </span>
    </li>
  )
}

function InstallGuideSheet({ open, onClose, platform }: { open: boolean; onClose: () => void; platform: Platform }) {
  const { t } = useLang()
  const steps: { icon: React.ReactNode; text: string }[] =
    platform === 'ios'
      ? [
          { icon: <ShareIcon />, text: t('install.guide.ios.step1') },
          { icon: <PlusSquareIcon />, text: t('install.guide.ios.step2') },
          { icon: <CheckIcon />, text: t('install.guide.ios.step3') },
        ]
      : [
          { icon: <KebabMenuIcon />, text: t('install.guide.android.step1') },
          { icon: <PlusSquareIcon />, text: t('install.guide.android.step2') },
          { icon: <CheckIcon />, text: t('install.guide.android.step3') },
        ]

  return (
    <Drawer.Root open={open} onOpenChange={o => { if (!o) onClose() }} noBodyStyles>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-60 bg-ink-black/40" />
        <Drawer.Content
          className="fixed inset-x-0 bottom-0 z-60 flex flex-col rounded-t-3xl-2 border-t-2 border-ink-black bg-linen-canvas p-20 outline-none"
          style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom))' }}
        >
          <Drawer.Handle className="mx-auto mb-14 mt-0 h-4 w-40 shrink-0 rounded-full-3 bg-ink-black/20" />
          <div className="mx-auto w-full max-w-md">
            <Drawer.Title className="font-sans text-[19px] font-extrabold leading-snug tracking-[-0.02em] text-ink-black">
              {t('install.guide.title')}
            </Drawer.Title>
            <ul className="mt-20 flex flex-col gap-16">
              {steps.map((s, i) => (
                <GuideStep key={i} index={i + 1} icon={s.icon} text={s.text} />
              ))}
            </ul>
            <button
              type="button"
              onClick={onClose}
              className="pressable mt-24 w-full rounded-full-2 border-2 border-ink-black bg-lime-spark py-14 font-sans text-body-sm font-bold text-ink-black"
            >
              {t('install.guide.done')}
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

export function InstallPrompt() {
  const { t } = useLang()
  const { platform, eligible } = useSyncExternalStore(emptySubscribe, getEligibilitySnapshot, getServerEligibility)
  const [showBanner, setShowBanner] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  }, [])

  // A delayed entrance so it never ambushes the very first paint - the app
  // itself is the pitch; this is just a nudge once someone's actually using it.
  useEffect(() => {
    if (!eligible) return
    const id = setTimeout(() => setShowBanner(true), 4000)
    return () => clearTimeout(id)
  }, [eligible])

  function dismissForGood() {
    setShowBanner(false)
    try { localStorage.setItem(DISMISS_KEY, '1') } catch {}
  }

  async function handleInstallTap() {
    if (deferredPrompt) {
      await deferredPrompt.prompt()
      await deferredPrompt.userChoice
      setDeferredPrompt(null)
      dismissForGood()
      return
    }
    setShowGuide(true)
  }

  if (!eligible) return null

  return (
    <>
      {showBanner && (
        <div
          className="fixed inset-x-0 bottom-0 z-45 flex justify-center px-14 pb-18.5 lg:pb-14"
          style={{ animation: 'riseIn 320ms var(--ease-out) both' }}
        >
          <div className="plate shadow-plate-sm flex w-full max-w-md items-center gap-10 rounded-2xl p-14">
            <span className="flex h-40 w-40 shrink-0 items-center justify-center rounded-lg border-2 border-ink-black bg-lime-spark text-ink-black">
              <PlusSquareIcon />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-sans text-body-sm font-bold text-ink-black">{t('install.title')}</p>
              <p className="truncate font-sans text-[11px] text-sage-mute">{t('install.subtitle')}</p>
            </div>
            <button
              type="button"
              onClick={handleInstallTap}
              className="pressable-sm shrink-0 rounded-full-2 border-2 border-ink-black bg-lime-spark px-14 py-8 font-sans text-caption font-bold text-ink-black"
            >
              {t('install.cta')}
            </button>
            <button
              type="button"
              onClick={dismissForGood}
              aria-label={t('install.dismiss')}
              className="pressable-sm shrink-0 flex h-24 w-24 items-center justify-center text-sage-mute"
            >
              <svg aria-hidden className="h-14 w-14" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
      <InstallGuideSheet
        open={showGuide}
        onClose={() => { setShowGuide(false); dismissForGood() }}
        platform={platform}
      />
    </>
  )
}
