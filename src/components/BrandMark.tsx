import Image from 'next/image'

/**
 * The TransitMY wordmark: the logo sticker + the name, used in every masthead.
 * The logo carries the same 2px ink ring as every other plate so it reads as
 * part of the poster system, not a pasted-in asset.
 */
export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <span className={`flex items-center gap-8 ${className}`}>
      <Image
        src="/transitMY-logo.jpeg"
        alt=""
        width={26}
        height={26}
        priority
        className="h-[26px] w-[26px] rounded-lg border-2 border-ink-black object-cover"
      />
      <span className="font-mono text-body-sm font-bold tracking-[-0.01em] text-ink-black">
        TransitMY
      </span>
    </span>
  )
}
