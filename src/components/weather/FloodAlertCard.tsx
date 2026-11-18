'use client'

import { useState } from 'react'
import { useLang } from '@/lib/i18n'
import { STATES, type StateCode } from '@/lib/flood'
import { useFloodAlerts } from '@/hooks/useFloodAlerts'
import { InstallGuideSheet } from '@/components/InstallPrompt'

/**
 * "Amaran banjir ke telefon" - the opt-in for flood push alerts.
 *
 * Motion: the switch knob slides on transform only (160ms, strong ease-out)
 * and the track's fill fades - state indication for an occasional, deliberate
 * action. State chips get press feedback and a colour fade, nothing more:
 * riders may tap several in a row, so they must feel instant.
 */

function BellIcon() {
  return (
    <svg aria-hidden className="h-20 w-20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  )
}

function Switch({ on, disabled, onToggle, label }: { on: boolean; disabled: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className="relative h-26 w-[46px] shrink-0 rounded-full-2 border-2 border-ink-black active:scale-[0.96] disabled:opacity-50"
      style={{
        backgroundColor: on ? 'var(--color-lime-spark)' : 'var(--color-white-plate)',
        transition: 'background-color 160ms var(--ease-out), transform 120ms var(--ease-out)',
      }}
    >
      <span
        aria-hidden
        className="absolute left-[2px] top-[2px] h-[18px] w-[18px] rounded-full-3 bg-ink-black"
        style={{
          transform: on ? 'translateX(20px)' : 'translateX(0)',
          transition: 'transform 160ms var(--ease-out)',
        }}
      />
    </button>
  )
}

export function FloodAlertCard({ suggestedState }: { suggestedState: StateCode | null }) {
  const { t, lang } = useLang()
  const alerts = useFloodAlerts(lang)
  const [showGuide, setShowGuide] = useState(false)

  // Nothing picked yet → pre-select the state the rider is looking at (or
  // standing in), so turning alerts on is one tap for most people.
  const picked: StateCode[] = alerts.states.length > 0 ? alerts.states : suggestedState ? [suggestedState] : []
  const on = alerts.enabled === true
  const canToggle = alerts.support === 'supported' && alerts.enabled !== null && !alerts.busy

  function toggleState(code: StateCode) {
    const next = picked.includes(code) ? picked.filter(c => c !== code) : [...picked, code]
    // While subscribed, never let the last state go - that would be "on, but
    // for nowhere". Turning alerts off is the switch's job.
    if (on && next.length === 0) return
    void alerts.setStates(next)
  }

  return (
    <div className="plate shadow-plate rounded-3xl-2 p-18">
      <div className="flex items-start gap-14">
        <span
          className="flex h-40 w-40 shrink-0 items-center justify-center rounded-lg border-2 border-ink-black text-ink-black"
          style={{ backgroundColor: on ? 'var(--color-lime-spark)' : 'var(--color-leaf-wash)', transition: 'background-color 160ms var(--ease-out)' }}
        >
          <BellIcon />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-sans text-[15px] font-extrabold leading-snug tracking-[-0.01em] text-ink-black">
            {t('alerts.title')}
          </p>
          <p className="mt-4 font-sans text-caption leading-relaxed text-sage-mute">
            {t('alerts.desc')}
          </p>
        </div>
        {alerts.support !== 'ios-needs-install' && (
          <Switch
            on={on}
            disabled={!canToggle}
            label={t('alerts.toggleAria')}
            onToggle={() => void (on ? alerts.disable() : alerts.enable(picked))}
          />
        )}
      </div>

      {/* Platform honesty - say exactly why the switch can't work here. */}
      {alerts.support === 'ios-needs-install' && (
        <div className="mt-14 flex items-center gap-10 rounded-2xl border-2 border-ink-black bg-leaf-wash p-14">
          <p className="min-w-0 flex-1 font-sans text-caption leading-snug text-ink-black">
            {t('alerts.iosInstall')}
          </p>
          <button
            type="button"
            onClick={() => setShowGuide(true)}
            className="pressable-sm shrink-0 rounded-full-2 border-2 border-ink-black bg-lime-spark px-14 py-8 font-sans text-caption font-bold text-ink-black"
          >
            {t('alerts.iosInstallCta')}
          </button>
        </div>
      )}
      {(alerts.support === 'unsupported' || alerts.support === 'not-configured') && (
        <p className="mt-14 rounded-2xl border-2 border-ink-black/15 bg-moss-tint px-14 py-10 font-sans text-caption leading-snug text-sage-mute">
          {t(alerts.support === 'unsupported' ? 'alerts.unsupported' : 'alerts.notConfigured')}
        </p>
      )}

      {/* State picker - which rivers you care about */}
      {(alerts.support === 'supported' || alerts.support === 'pending') && (
        <div className="mt-16">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-sage-mute">
            {t('alerts.pickStates')}
          </p>
          <div className="mt-8 flex flex-wrap gap-1.5">
            {STATES.map(s => {
              const active = picked.includes(s.code)
              return (
                <button
                  key={s.code}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleState(s.code)}
                  disabled={alerts.busy}
                  className="rounded-full-2 border-2 px-10 py-1 font-sans text-caption font-bold active:scale-[0.96] disabled:opacity-60"
                  style={{
                    borderColor: active ? 'var(--color-ink-black)' : 'rgb(0 0 0 / 0.15)',
                    backgroundColor: active ? 'var(--color-lime-spark)' : 'var(--color-white-plate)',
                    color: active ? 'var(--color-ink-black)' : 'var(--color-midnight-ink)',
                    transition: 'background-color 150ms var(--ease-out), border-color 150ms var(--ease-out), transform 120ms var(--ease-out)',
                  }}
                >
                  {s.short}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Feedback. A failure says WHY in plain words, then prints the technical
          code underneath - so "it doesn't work" can be diagnosed off a screenshot. */}
      {alerts.busy ? (
        <p role="status" className="mt-14 font-mono text-[11px] font-bold leading-snug text-forest-ink">
          {t('alerts.working')}
        </p>
      ) : alerts.notice ? (
        <div
          key={`${alerts.notice.key}|${alerts.notice.detail ?? ''}`}
          role={alerts.notice.tone === 'error' ? 'alert' : 'status'}
          className={`mt-14 rounded-2xl border-2 border-ink-black p-14 ${
            alerts.notice.tone === 'error' ? 'bg-maroon-plate text-white-plate' : 'bg-leaf-wash text-ink-black'
          }`}
          style={{ animation: 'searchIn 200ms var(--ease-out) both' }}
        >
          <p className="font-sans text-caption font-semibold leading-relaxed">{t(alerts.notice.key)}</p>
          {alerts.notice.detail && (
            <p className="mt-8 break-words font-mono text-[10px] leading-snug tracking-[0.04em] opacity-80">
              {t('alerts.detail')}: {alerts.notice.detail}
            </p>
          )}
        </div>
      ) : null}

      <InstallGuideSheet open={showGuide} onClose={() => setShowGuide(false)} platform="ios" />
    </div>
  )
}
