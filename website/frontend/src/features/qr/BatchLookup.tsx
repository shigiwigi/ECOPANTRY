import { useQuery } from "@tanstack/react-query"
import { CircleAlert, CloudOff, Info, LoaderCircle, PackageSearch } from "lucide-react"
import type { ReactNode } from "react"
import { Link } from "react-router"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/features/auth/auth-context"
import { cn } from "@/lib/utils"
import { formatCode } from "./batch-label"
import { batchByLabelQuery, lookupProblem, type BatchLabelLookup, type LookupProblem } from "./batches"
import { daysUntil, formatCalendarDate } from "./dates"

const PROBLEM_TEXT: Record<LookupProblem, { title: string; message: string; tone: "info" | "warning" | "danger" }> = {
  unavailable: {
    title: "Batch details aren't connected yet",
    message:
      "The label is valid and the server accepted the lookup, but batch records arrive with the inventory module. Until then no batch details can be shown. Nothing was changed.",
    tone: "info",
  },
  "not-found": {
    title: "No batch has this label",
    message: "Check the code, or ask an administrator whether the batch was removed.",
    tone: "warning",
  },
  forbidden: {
    title: "Your account can't view batches",
    message: "Ask an administrator if you need batch access.",
    tone: "danger",
  },
  invalid: {
    title: "The server didn't accept this code",
    message: "Check the code printed on the label and try again.",
    tone: "warning",
  },
  unreachable: {
    title: "Can't reach the EcoPantry server",
    message: "Check the connection and try again.",
    tone: "danger",
  },
  failed: {
    title: "The batch couldn't be looked up",
    message: "Try again shortly.",
    tone: "danger",
  },
}

const TONE_CLASS = {
  info: "border-info/40 bg-info/10",
  warning: "border-warning/40 bg-warning/10",
  danger: "border-destructive/40 bg-destructive/10",
}

/** What the backend says about a scanned code. Read-only: looking up never changes stock. */
export function BatchLookup({ code }: { code: string }) {
  const { isPreview } = useAuth()

  if (isPreview) {
    return (
      <Notice icon={Info} tone="info" title="Lookup needs a real sign-in">
        The development preview has no account, so the server won't share batch details.
      </Notice>
    )
  }
  return <LiveLookup code={code} />
}

function LiveLookup({ code }: { code: string }) {
  const query = useQuery(batchByLabelQuery(code))

  if (query.isPending) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" aria-hidden />
        Looking up batch {formatCode(code)}…
      </p>
    )
  }
  if (query.isError) {
    const problem = lookupProblem(query.error)
    const text = PROBLEM_TEXT[problem]
    const icon = problem === "unreachable" ? CloudOff : problem === "unavailable" ? Info : CircleAlert
    const canRetry = problem === "unreachable" || problem === "failed"
    return (
      <Notice icon={icon} tone={text.tone} title={text.title}>
        {text.message}
        {canRetry && (
          <Button variant="outline" onClick={() => void query.refetch()} className="mt-3 h-11 sm:h-9">
            Try again
          </Button>
        )}
      </Notice>
    )
  }
  return <BatchDetails batch={query.data} />
}

const STATUS_LABELS: Record<BatchLabelLookup["status"], string> = {
  in_stock: "In stock",
  used_up: "Used up",
  discarded: "Discarded",
}

function BatchDetails({ batch }: { batch: BatchLabelLookup }) {
  const days = batch.expires_on ? daysUntil(batch.expires_on) : null
  const expiry =
    batch.expires_on &&
    `${formatCalendarDate(batch.expires_on)}${days === null ? "" : days < 0 ? " (expired)" : days === 0 ? " (today)" : ` (in ${days} day${days === 1 ? "" : "s"})`}`

  const rows: [string, ReactNode][] = [
    ["Ingredient", batch.ingredient_name],
    ["Batch code", <span key="code" className="font-mono">{formatCode(batch.code)}</span>],
    ["Status", STATUS_LABELS[batch.status] ?? batch.status],
    ["Use by", expiry || "Not recorded"],
    ["Received", batch.received_on ? formatCalendarDate(batch.received_on) : "Not recorded"],
    ["Remaining", batch.remaining_quantity ? `${batch.remaining_quantity} ${batch.unit ?? ""}`.trim() : "Not recorded"],
    ["Stored in", batch.storage_location ?? "Not recorded"],
  ]
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-muted-foreground">{term}</dt>
            <dd className={cn("min-w-0 break-words", term === "Use by" && days !== null && days < 0 && "font-medium text-destructive")}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {batch.batch_id && (
        <Button variant="outline" asChild className="h-11 sm:h-9">
          <Link to={`/portal/batches?batch=${batch.batch_id}`}>Open batch</Link>
        </Button>
      )}
    </div>
  )
}

function Notice({
  icon: Icon,
  tone,
  title,
  children,
}: {
  icon: typeof PackageSearch
  tone: keyof typeof TONE_CLASS
  title: string
  children: ReactNode
}) {
  return (
    <div role={tone === "info" ? "status" : "alert"} className={cn("rounded-md border px-4 py-3", TONE_CLASS[tone])}>
      <p className="flex items-center gap-2 text-sm font-medium">
        <Icon className="size-4 shrink-0" aria-hidden />
        {title}
      </p>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  )
}
