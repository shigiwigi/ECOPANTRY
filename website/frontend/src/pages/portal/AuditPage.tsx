import { useQuery } from "@tanstack/react-query"
import { ClipboardList } from "lucide-react"
import { useId, useState } from "react"
import { EmptyState } from "@/components/common/EmptyState"
import { PageHeader } from "@/components/layout/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getModule } from "@/config/portal-modules"
import { useAuth } from "@/features/auth/auth-context"
import { auditQuery, EMPTY_AUDIT_FILTERS, formatDateTime, type AuditFilters } from "@/features/records/api"
import { Pager, TableShell } from "@/features/records/shared"
import { problemText, TD, TH } from "@/features/records/helpers"

export default function AuditPage() {
  const module = getModule("audit")
  const { isPreview } = useAuth()

  return (
    <div className="space-y-6">
      <PageHeader title={module.title} description={module.summary} />
      {isPreview ? (
        <EmptyState
          icon={ClipboardList}
          title="Needs a real sign-in"
          description="The development preview has no account, so the server won't share the audit log."
        />
      ) : (
        <AuditLog />
      )}
    </div>
  )
}

function AuditLog() {
  const id = useId()
  const [draft, setDraft] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS)
  const [filters, setFilters] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS)
  const [offset, setOffset] = useState(0)
  const events = useQuery(auditQuery(filters, offset))

  const change = (key: keyof AuditFilters) => (event: { target: { value: string } }) =>
    setDraft((current) => ({ ...current, [key]: event.target.value.trim() }))

  return (
    <div className="space-y-4">
      <form
        aria-label="Filter the audit log"
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
        onSubmit={(event) => {
          event.preventDefault()
          setFilters(draft)
          setOffset(0)
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-action`}>Event</Label>
          <Input id={`${id}-action`} placeholder="e.g. waste.recorded" value={draft.action} onChange={change("action")} className="font-mono" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-target`}>Target</Label>
          <Input id={`${id}-target`} placeholder="e.g. waste_record" value={draft.target_type} onChange={change("target_type")} className="font-mono" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-from`}>From</Label>
          <Input id={`${id}-from`} type="date" value={draft.date_from} onChange={change("date_from")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-to`}>To</Label>
          <Input id={`${id}-to`} type="date" value={draft.date_to} onChange={change("date_to")} />
        </div>
        <div className="flex gap-2">
          <Button type="submit">Apply</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraft(EMPTY_AUDIT_FILTERS)
              setFilters(EMPTY_AUDIT_FILTERS)
              setOffset(0)
            }}
          >
            Clear
          </Button>
        </div>
      </form>

      {events.isError ? (
        <EmptyState title="The audit log couldn't be loaded" description={problemText(events.error, "Try again.")}>
          <Button variant="outline" size="sm" onClick={() => events.refetch()}>
            Try again
          </Button>
        </EmptyState>
      ) : !events.data ? (
        <p className="text-sm text-muted-foreground">Loading the audit log…</p>
      ) : events.data.items.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No events match" description="Change or clear the filters to see more." />
      ) : (
        <>
          <TableShell caption="Audit events, newest first">
            <thead className="border-b">
              <tr>
                <th scope="col" className={TH}>Time</th>
                <th scope="col" className={TH}>Who</th>
                <th scope="col" className={TH}>Event</th>
                <th scope="col" className={TH}>Target</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {events.data.items.map((event) => (
                <tr key={event.id}>
                  <td className={`${TD} whitespace-nowrap`}>{formatDateTime(event.occurred_at)}</td>
                  <td className={TD}>{event.actor?.full_name ?? actorLabel(event.actor_type)}</td>
                  <td className={`${TD} font-mono text-xs`}>{event.action}</td>
                  <td className={`${TD} font-mono text-xs`}>
                    {event.target_type ? `${event.target_type}${event.target_id ? ` ${event.target_id.slice(0, 8)}` : ""}` : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
          <Pager page={events.data} onOffset={setOffset} />
        </>
      )}
    </div>
  )
}

function actorLabel(actorType: string): string {
  return actorType === "cli" ? "Server operator" : actorType === "device" ? "Sensor station" : "Not signed in"
}
