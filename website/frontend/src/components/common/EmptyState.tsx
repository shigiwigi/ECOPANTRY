import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: ReactNode
  children?: ReactNode
  className?: string
}

/** Honest "nothing to show yet" block. Use it instead of placeholder data. */
export function EmptyState({ icon: Icon, title, description, children, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-2 rounded-lg border border-dashed bg-card/60 px-5 py-6",
        className,
      )}
    >
      {Icon && <Icon className="size-5 text-muted-foreground" aria-hidden />}
      <p className="font-medium">{title}</p>
      {description && <div className="max-w-prose text-sm text-muted-foreground">{description}</div>}
      {children}
    </div>
  )
}
