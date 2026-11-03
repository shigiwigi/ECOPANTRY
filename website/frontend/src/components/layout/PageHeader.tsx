import type { ReactNode } from "react"
import { useDocumentTitle } from "@/lib/document-title"

interface PageHeaderProps {
  title: string
  description?: ReactNode
  actions?: ReactNode
  /** Browser tab title, when it should differ from the visible heading. */
  documentTitle?: string
}

/** Heading block for portal pages. Also sets the browser tab title. */
export function PageHeader({ title, description, actions, documentTitle }: PageHeaderProps) {
  useDocumentTitle(documentTitle ?? title, "portal")

  return (
    <header className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl xl:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
    </header>
  )
}
