import { useQuery } from "@tanstack/react-query"
import { Inbox } from "lucide-react"
import { useId, useState } from "react"
import { EmptyState } from "@/components/common/EmptyState"
import { PageHeader } from "@/components/layout/PageHeader"
import { Button } from "@/components/ui/button"
import { getModule } from "@/config/portal-modules"
import { useAuth } from "@/features/auth/auth-context"
import { enquiriesQuery, formatDateTime, useMarkEnquiryRead, type Enquiry } from "@/features/records/api"
import { Pager } from "@/features/records/shared"
import { problemText } from "@/features/records/helpers"
import { cn } from "@/lib/utils"

export default function EnquiriesPage() {
  const module = getModule("enquiries")
  const { isPreview } = useAuth()

  return (
    <div className="space-y-6">
      <PageHeader title={module.title} description={module.summary} />
      {isPreview ? (
        <EmptyState
          icon={Inbox}
          title="Needs a real sign-in"
          description="The development preview has no account, so the server won't share enquiries."
        />
      ) : (
        <EnquiryList />
      )}
    </div>
  )
}

function EnquiryList() {
  const checkboxId = useId()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [offset, setOffset] = useState(0)
  const enquiries = useQuery(enquiriesQuery(offset, unreadOnly))

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <input
          id={checkboxId}
          type="checkbox"
          className="size-4 accent-primary"
          checked={unreadOnly}
          onChange={(event) => {
            setUnreadOnly(event.target.checked)
            setOffset(0)
          }}
        />
        <label htmlFor={checkboxId} className="text-sm">
          Unread only
        </label>
      </div>

      {enquiries.isError ? (
        <EmptyState title="Enquiries couldn't be loaded" description={problemText(enquiries.error, "Try again.")}>
          <Button variant="outline" size="sm" onClick={() => enquiries.refetch()}>
            Try again
          </Button>
        </EmptyState>
      ) : !enquiries.data ? (
        <p className="text-sm text-muted-foreground">Loading enquiries…</p>
      ) : enquiries.data.items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title={unreadOnly ? "No unread enquiries" : "No enquiries yet"}
          description="Messages from the website's contact form appear here. They are deleted after 12 months."
        />
      ) : (
        <>
          <ul className="space-y-3">
            {enquiries.data.items.map((enquiry) => (
              <EnquiryItem key={enquiry.id} enquiry={enquiry} />
            ))}
          </ul>
          <Pager page={enquiries.data} onOffset={setOffset} />
        </>
      )}
    </div>
  )
}

function EnquiryItem({ enquiry }: { enquiry: Enquiry }) {
  const markRead = useMarkEnquiryRead()
  const unread = enquiry.read_at === null

  return (
    <li className={cn("rounded-lg border bg-card p-4", unread && "border-l-4 border-l-gold")}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="font-medium">
            {enquiry.name}
            {unread && <span className="ml-2 rounded-full bg-gold/15 px-2 py-0.5 text-xs font-normal text-foreground">New</span>}
          </p>
          <a className="break-all text-sm text-muted-foreground underline underline-offset-4" href={`mailto:${enquiry.email}`}>
            {enquiry.email}
          </a>
        </div>
        <time className="text-xs text-muted-foreground" dateTime={enquiry.created_at}>
          {formatDateTime(enquiry.created_at)}
        </time>
      </div>
      <p className="mt-3 whitespace-pre-wrap break-words text-sm">{enquiry.message}</p>
      {unread && (
        <div className="mt-3">
          <Button variant="outline" size="sm" disabled={markRead.isPending} onClick={() => markRead.mutate(enquiry.id)}>
            Mark as read
          </Button>
          {markRead.isError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {problemText(markRead.error, "Couldn't mark it as read.")}
            </p>
          )}
        </div>
      )}
    </li>
  )
}
