import { useQuery } from "@tanstack/react-query"
import { CloudOff, Download, FileText } from "lucide-react"
import { useId, useState } from "react"
import { EmptyState } from "@/components/common/EmptyState"
import { PageHeader } from "@/components/layout/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { getModule } from "@/config/portal-modules"
import { useAuth } from "@/features/auth/auth-context"
import {
  EXPIRY_WINDOWS,
  REPORT_KINDS,
  REPORT_LABELS,
  defaultFilters,
  downloadReport,
  rangeProblem,
  reportQuery,
  usesDateRange,
  type ReportFilters,
  type ReportFormat,
  type ReportKind,
  type ReportSection,
} from "@/features/reports/api"
import { ApiError } from "@/lib/api/client"
import { cn } from "@/lib/utils"

function loadError(error: unknown): string {
  if (error instanceof ApiError) return error.message
  return "The report couldn't be loaded."
}

export default function ReportsPage() {
  const module = getModule("reports")
  const { isPreview, user } = useAuth()
  const canExport = Boolean(user?.permissions?.includes("reports.export"))

  return (
    <div className="space-y-6">
      <PageHeader title={module.title} description={module.summary} />
      {isPreview ? (
        <EmptyState
          icon={CloudOff}
          title="Needs a real sign-in"
          description="The development preview has no account, so the server won't build reports."
        />
      ) : (
        <ReportsViewer canExport={canExport} />
      )}
    </div>
  )
}

function ReportsViewer({ canExport }: { canExport: boolean }) {
  const [kind, setKind] = useState<ReportKind>("stock")
  const [filters, setFilters] = useState<ReportFilters>(() => defaultFilters())
  const [busy, setBusy] = useState<ReportFormat | null>(null)
  const [downloadError, setDownloadError] = useState<string | null>(null)
  const fromId = useId()
  const toId = useId()
  const windowId = useId()

  const problem = rangeProblem(kind, filters)
  const report = useQuery(reportQuery(kind, filters, problem === null))

  const download = async (format: ReportFormat) => {
    setBusy(format)
    setDownloadError(null)
    try {
      await downloadReport(kind, filters, format)
    } catch (error) {
      setDownloadError(error instanceof ApiError ? error.message : "The download failed.")
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-label="Report" className="space-y-4">
      <div role="tablist" aria-label="Report type" className="inline-flex max-w-full overflow-x-auto rounded-lg border bg-card p-0.5">
        {REPORT_KINDS.map((key) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={kind === key}
            onClick={() => {
              setKind(key)
              setDownloadError(null)
            }}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              kind === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {REPORT_LABELS[key]}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {usesDateRange(kind) && (
          <>
            <div className="space-y-1">
              <Label htmlFor={fromId}>From</Label>
              <Input
                id={fromId}
                type="date"
                value={filters.dateFrom}
                max={filters.dateTo || undefined}
                onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor={toId}>To</Label>
              <Input
                id={toId}
                type="date"
                value={filters.dateTo}
                min={filters.dateFrom || undefined}
                onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })}
              />
            </div>
          </>
        )}
        {kind === "expiry" && (
          <div className="space-y-1">
            <Label htmlFor={windowId}>Near-expiry window</Label>
            <NativeSelect
              id={windowId}
              value={filters.days}
              onChange={(event) => setFilters({ ...filters, days: Number(event.target.value) })}
            >
              {EXPIRY_WINDOWS.map((value) => (
                <option key={value} value={value}>
                  {value} days
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        {kind === "stock" && <p className="text-sm text-muted-foreground">Stock as of now.</p>}

        {canExport && (
          <div className="flex gap-2 sm:ml-auto">
            {(["csv", "pdf"] as const).map((format) => (
              <Button
                key={format}
                variant="outline"
                disabled={problem !== null || busy !== null}
                onClick={() => download(format)}
              >
                <Download aria-hidden />
                {busy === format ? "Preparing…" : `Download ${format.toUpperCase()}`}
              </Button>
            ))}
          </div>
        )}
      </div>

      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {problem}
        </p>
      )}
      {downloadError && (
        <p role="alert" className="text-sm text-destructive">
          {downloadError}
        </p>
      )}

      {problem ? null : report.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading report…
        </p>
      ) : report.isError ? (
        <EmptyState icon={CloudOff} title="Couldn't load the report" description={loadError(report.error)}>
          <Button variant="outline" onClick={() => report.refetch()}>
            Try again
          </Button>
        </EmptyState>
      ) : (
        <div className="space-y-5">
          <p className="text-sm text-muted-foreground">
            {report.data.filters.map((f) => `${f.label}: ${f.value}`).join(" · ")}
          </p>
          {report.data.notes.length > 0 && (
            <ul className="space-y-1 text-sm text-muted-foreground">
              {report.data.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
          {report.data.sections.map((section) => (
            <SectionTable key={section.title} section={section} />
          ))}
        </div>
      )}
    </section>
  )
}

function SectionTable({ section }: { section: ReportSection }) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold">{section.title}</h2>
      {section.rows.length === 0 ? (
        <EmptyState icon={FileText} title="No rows" description="Nothing matches these filters." />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full min-w-[32rem] text-sm">
            <caption className="sr-only">{section.title}</caption>
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                {section.columns.map((column) => (
                  <th key={column} scope="col" className="px-3 py-2 font-medium whitespace-nowrap">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {section.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, i) => (
                    <td key={i} className="px-3 py-2 align-top">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
