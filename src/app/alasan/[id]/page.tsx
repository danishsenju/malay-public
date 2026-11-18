import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { cache } from 'react'
import { fetchDisruption } from '@/lib/disruptions'
import { disruptionCopy } from '@/lib/disruptionCopy'
import { getServerLang, serverT } from '@/lib/serverLang'
import type { Lang } from '@/lib/i18n'
import { PageHeader } from '@/components/PageHeader'
import { ShareButton } from '@/components/ShareButton'

export const dynamic = 'force-dynamic'

/**
 * /alasan/[id] - a shareable Service Disruption Record ("Alasan Lewat").
 *
 * The link is the product: in WhatsApp it unfurls as the record image
 * (/api/og/alasan), and whoever taps it lands here - on the evidence, with
 * its source and what it does and doesn't prove - one tap from the live app.
 * Every number is read from the Delay Ledger row by id; nothing comes from
 * the URL except the id and the language.
 */

interface Props {
  params: Promise<{ id: string }>
  searchParams: Promise<{ lang?: string }>
}

// generateMetadata and the page both need the row - fetch it once per request.
const getRecord = cache((id: number) => fetchDisruption(id))

async function resolve({ params, searchParams }: Props) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  // ?lang= travels with a shared link, so the recipient's preview and page
  // match the language the sharer chose. Otherwise: the visitor's own setting.
  const lang: Lang = sp.lang === 'en' ? 'en' : sp.lang === 'ms' ? 'ms' : await getServerLang()
  const d = await getRecord(parseInt(id, 10))
  return { d, lang }
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { d, lang } = await resolve(props)
  if (!d) return { title: 'TransitMY' }
  const c = disruptionCopy(d, lang)
  const image = `/api/og/alasan?id=${d.id}&lang=${lang}`
  return {
    title: `${c.metaTitle} · TransitMY`,
    description: c.metaDescription,
    openGraph: {
      title: c.metaTitle,
      description: c.metaDescription,
      siteName: 'TransitMY',
      type: 'article',
      images: [{ url: image, width: 1200, height: 630, alt: c.metaTitle }],
    },
    twitter: { card: 'summary_large_image', title: c.metaTitle, description: c.metaDescription, images: [image] },
  }
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-sage-mute">{label}</dt>
      <dd className="mt-2 font-mono text-[15px] font-bold leading-snug text-ink-black tabular-nums">{value}</dd>
    </div>
  )
}

export default async function DisruptionRecordPage(props: Props) {
  const { d, lang } = await resolve(props)
  if (!d) notFound()

  const t = serverT(lang)
  const c = disruptionCopy(d, lang)

  // Absolute URL for the share sheet / clipboard - relative links don't paste.
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? ''
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https')
  const shareUrl = `${proto}://${host}/alasan/${d.id}?lang=${lang}`

  return (
    <div className="min-h-screen bg-linen-canvas">
      <PageHeader />
      <main className="mx-auto max-w-md px-20 pb-128 lg:max-w-2xl lg:pb-64">
        <p className="pt-26 font-mono text-[11px] font-medium uppercase tracking-[0.2em] text-sage-mute">
          {t('alasan.record')} #{d.id} · data.gov.my
        </p>

        {/* ── The record ── (one entrance: this page is opened from a link,
            rarely, so a single settle-in is appropriate) */}
        <article
          className="plate shadow-plate mt-14 overflow-hidden rounded-3xl-2"
          style={{ animation: 'cardEnter 300ms var(--ease-out) both' }}
        >
          <div className="flex items-center justify-between gap-10 border-b-2 border-ink-black bg-maroon-plate px-18 py-10">
            <span className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-white-plate">
              {c.title}
            </span>
            <span className="font-mono text-[12px] font-bold text-lime-spark">TransitMY</span>
          </div>

          <div className="px-18 pb-18 pt-16">
            <div className="flex flex-wrap items-center gap-10">
              <h1 className="font-sans text-[26px] font-extrabold leading-tight tracking-[-0.02em] text-ink-black">
                {c.network}
              </h1>
              {(c.route ?? c.vehicle) && (
                <span className="rounded-lg border-2 border-ink-black bg-linen-canvas px-8 py-0.75 font-mono text-[12px] font-bold text-ink-black">
                  {c.route ?? c.vehicle}
                </span>
              )}
            </div>
            <p className="mt-4 font-sans text-[15px] font-bold text-maroon-plate">{c.headline}</p>

            <div className="mt-18 flex items-end justify-between gap-14">
              <dl className="grid gap-10">
                <Fact label={t('alasan.date')} value={c.date} />
                <Fact label={t('alasan.time')} value={`${c.start} – ${c.end} MYT`} />
              </dl>
              <div className="shrink-0 rounded-2xl border-2 border-ink-black bg-linen-canvas px-14 py-10 text-center">
                <span className="block font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-sage-mute">
                  {t('alasan.duration')}
                </span>
                <span className="mt-2 flex items-baseline justify-center gap-1.5 text-ink-black">
                  <span className="font-mono text-[44px] font-bold leading-none tracking-[-0.03em] tabular-nums">{c.minutes}</span>
                  <span className="font-mono text-[13px] font-bold">MIN</span>
                </span>
                {c.ongoing && (
                  <span className="mt-2 block font-mono text-[10px] font-bold uppercase text-maroon-plate">{c.end}</span>
                )}
              </div>
            </div>
          </div>

          <div className="mx-18 flex justify-between gap-10 border-t-2 border-dashed border-ink-black/20 py-10 font-mono text-[10px] font-medium text-sage-mute">
            <span>{c.source}</span>
            <span className="shrink-0">#{d.id}</span>
          </div>
          {/* On the ticket itself so it survives a screenshot. */}
          <p className="mx-18 pb-14 font-sans text-caption font-semibold leading-snug text-ink-black">{c.scopeShort}</p>

          <div className="flex flex-wrap items-center justify-between gap-x-10 gap-y-1 border-t-2 border-ink-black bg-lime-spark px-18 py-10 font-mono text-[11px] font-bold text-ink-black">
            <span>TransitMY</span>
            <span>{t('alasan.promo')}</span>
          </div>
        </article>

        {/* ── Share ── */}
        <div className="mt-20 flex justify-center">
          <ShareButton
            title={c.metaTitle}
            text={c.shareText}
            url={shareUrl}
            label={t('alasan.share')}
            copiedLabel={t('alasan.copied')}
            className="w-full sm:w-auto"
          />
        </div>

        {/* ── What it proves (and what it doesn't) ── */}
        <section className="plate mt-26 rounded-2xl p-18">
          <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-ink-black">
            {t('alasan.what')}
          </h2>
          <p className="mt-8 font-sans text-body-sm leading-relaxed text-ink-black">{c.explain}</p>
          <p className="mt-8 font-sans text-caption leading-relaxed text-sage-mute">{c.scope}</p>
        </section>

        {/* ── The app, for whoever tapped the link ── */}
        <section className="mt-26 rounded-3xl-2 border-2 border-ink-black bg-cobalt-band p-20 text-white-plate">
          <h2 className="font-sans text-[24px] font-extrabold leading-tight tracking-[-0.02em]">
            {t('alasan.cta.title')}
          </h2>
          <p className="mt-8 font-sans text-body-sm leading-relaxed text-white-plate/85">
            {t('alasan.cta.desc')}
          </p>
          <div className="mt-16 flex flex-wrap gap-10">
            <Link
              href="/"
              className="pressable-gpu rounded-full-2 border-2 border-ink-black bg-lime-spark px-18 py-10 font-sans text-[15px] font-bold text-ink-black"
            >
              {t('alasan.cta.open')}
            </Link>
            <Link
              href="/report"
              className="pressable-gpu rounded-full-2 border-2 border-ink-black bg-white-plate px-18 py-10 font-sans text-[15px] font-bold text-ink-black"
            >
              {t('alasan.cta.report')}
            </Link>
          </div>
        </section>
      </main>
    </div>
  )
}
