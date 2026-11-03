import { cn } from "@/lib/utils"

/** EcoPantry mark: a leaf-shaped grain inside a pantry jar outline, plus wordmark. */
export function Logo({ className, showWordmark = true }: { className?: string; showWordmark?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg viewBox="0 0 32 32" className="size-8 shrink-0 md:size-9" aria-hidden focusable="false">
        <rect x="5" y="3" width="22" height="5" rx="1.5" className="fill-gold" />
        <path
          d="M7 10h18v15a4 4 0 0 1-4 4H11a4 4 0 0 1-4-4z"
          className="fill-none stroke-current"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M16 13c4 2.5 4.6 7.7 0 12-4.6-4.3-4-9.5 0-12z" className="fill-current" />
      </svg>
      {showWordmark && <span className="font-display text-xl leading-none font-semibold tracking-tight md:text-2xl">EcoPantry</span>}
    </span>
  )
}
