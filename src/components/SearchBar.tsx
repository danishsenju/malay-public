'use client'

interface SearchBarProps {
  onClick: () => void
}

export function SearchBar({ onClick }: SearchBarProps) {
  return (
    <button
      type="button"
      aria-label="Cari hentian"
      onClick={onClick}
      className="
        plate pressable flex w-full items-center gap-3
        rounded-full-2 px-10 py-2.25 text-left
        [@media(hover:hover)_and_(pointer:fine)]:hover:bg-leaf-wash
      "
    >
      {/* Magnifier sits in a lime sticker — the plate's one accent */}
      <span className="flex h-[32px] w-[32px] shrink-0 items-center justify-center rounded-full-3 border-2 border-ink-black bg-lime-spark">
        <svg
          aria-hidden
          className="h-3.75 w-3.75 text-ink-black"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <circle cx="11" cy="11" r="8" />
          <path strokeLinecap="round" d="m21 21-4.35-4.35" />
        </svg>
      </span>

      <span className="font-sans text-body-sm font-medium text-sage-mute">
        Cari hentian atau laluan…
      </span>

      {/* Coverage chips */}
      <span className="ml-auto mr-8 flex shrink-0 items-center gap-1.5">
        {['Bus', 'Rail', 'KTM'].map(net => (
          <span
            key={net}
            className="rounded-full-2 border-2 border-ink-black bg-linen-canvas px-1.75 py-px font-mono text-[10px] font-bold text-ink-black"
          >
            {net}
          </span>
        ))}
      </span>
    </button>
  )
}
