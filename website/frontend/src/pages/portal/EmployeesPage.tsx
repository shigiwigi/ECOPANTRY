import { useQuery, type UseQueryResult } from "@tanstack/react-query"
import { CloudOff, IdCard } from "lucide-react"
import { useId, useState, type FormEvent } from "react"
import { EmptyState } from "@/components/common/EmptyState"
import { PageHeader } from "@/components/layout/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { getModule } from "@/config/portal-modules"
import { useAuth } from "@/features/auth/auth-context"
import {
  accountName,
  cardsQuery,
  isActiveAccount,
  normalizeUid,
  SCAN_RESULT_LABELS,
  scansQuery,
  staffAccountsQuery,
  unassignedUids,
  useAssignCard,
  useRevokeCard,
  type RfidCard,
  type RfidScan,
} from "@/features/rfid/api"
import { formatAge } from "@/features/sensors/api"
import { ApiError } from "@/lib/api/client"
import { useNow } from "@/lib/use-now"
import { cn } from "@/lib/utils"

function problemText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.isUnreachable) return "Can't reach the EcoPantry server."
  if (error instanceof ApiError) return error.message
  return fallback
}

export default function EmployeesPage() {
  const module = getModule("employees")
  const { isPreview, user } = useAuth()
  // UX only: the backend allows assigning and revoking with `employees.manage` (administrators).
  const canManage = user?.role === "admin"

  return (
    <div className="space-y-6">
      <PageHeader title={module.title} description={module.summary} />
      {isPreview ? (
        <EmptyState
          icon={IdCard}
          title="Needs a real sign-in"
          description="The development preview has no account, so the server won't share card records."
        />
      ) : (
        <CardManager canManage={canManage} />
      )}
    </div>
  )
}

function CardManager({ canManage }: { canManage: boolean }) {
  const cards = useQuery(cardsQuery)
  const scans = useQuery(scansQuery)
  const [message, setMessage] = useState("")
  const [prefillUid, setPrefillUid] = useState("")

  return (
    <>
      <p role="status" className={cn("text-sm", message ? "rounded-md border border-success/40 bg-success/10 px-3 py-2" : "sr-only")}>
        {message}
      </p>

      {canManage && (
        <AssignForm
          key={prefillUid}
          initialUid={prefillUid}
          candidates={scans.data && cards.data ? unassignedUids(scans.data, cards.data) : []}
          onPick={setPrefillUid}
          onMessage={setMessage}
        />
      )}

      <section aria-labelledby="rfid-cards" className="space-y-3">
        <h2 id="rfid-cards" className="text-base font-semibold">
          Cards
        </h2>
        {cards.isPending ? (
          <p className="text-sm text-muted-foreground">Loading cards…</p>
        ) : cards.isError ? (
          <EmptyState icon={CloudOff} title="Cards couldn't be loaded" description={problemText(cards.error, "")}>
            <Button variant="outline" size="sm" onClick={() => cards.refetch()}>
              Try again
            </Button>
          </EmptyState>
        ) : cards.data.length === 0 ? (
          <EmptyState
            icon={IdCard}
            title="No cards assigned"
            description="Tap a card on the station, then assign the UID it shows here to a staff member. Only assigned cards can start a live session."
          />
        ) : (
          <CardList cards={cards.data} canManage={canManage} onMessage={setMessage} />
        )}
      </section>

      <ScanLog query={scans} />
    </>
  )
}

function AssignForm({
  initialUid,
  candidates,
  onPick,
  onMessage,
}: {
  initialUid: string
  candidates: string[]
  onPick: (uid: string) => void
  onMessage: (message: string) => void
}) {
  const id = useId()
  const accounts = useQuery(staffAccountsQuery)
  const assign = useAssignCard()
  const [uid, setUid] = useState(initialUid)
  const [employeeId, setEmployeeId] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const active = (accounts.data ?? []).filter(isActiveAccount)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (assign.isPending) return
    const normalized = normalizeUid(uid)
    if (!normalized) {
      setProblem("Enter the card UID shown on the station, for example D5:61:E9:E7.")
      return
    }
    if (!employeeId) {
      setProblem("Choose who the card belongs to.")
      return
    }
    setProblem(null)
    try {
      const card = await assign.mutateAsync({ uid: normalized, employeeId })
      onMessage(`Card ${card.uid} now belongs to ${card.employee.full_name}.`)
      setUid("")
      setEmployeeId("")
      onPick("")
    } catch (error) {
      setProblem(problemText(error, "The card couldn't be assigned."))
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-3 rounded-lg border bg-card p-4">
      <h2 id={`${id}-title`} className="text-base font-semibold">
        Assign a card
      </h2>
      {candidates.length > 0 && (
        <div className="space-y-1.5 text-sm">
          <p className="text-muted-foreground">Recently tapped cards nobody holds:</p>
          <div className="flex flex-wrap gap-2">
            {candidates.map((candidate) => (
              <Button key={candidate} type="button" size="sm" variant="outline" className="font-mono" onClick={() => onPick(candidate)}>
                {candidate}
              </Button>
            ))}
          </div>
        </div>
      )}
      <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-uid`}>Card UID</Label>
          <Input
            id={`${id}-uid`}
            value={uid}
            onChange={(event) => setUid(event.target.value)}
            placeholder="D5:61:E9:E7"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            aria-invalid={problem ? true : undefined}
            aria-describedby={problem ? `${id}-problem` : undefined}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-employee`}>Staff member</Label>
          <NativeSelect id={`${id}-employee`} value={employeeId} onChange={(event) => setEmployeeId(event.target.value)}>
            <option value="">{accounts.isPending ? "Loading staff…" : "Choose…"}</option>
            {active.map((account) => (
              <option key={account.id} value={account.id}>
                {accountName(account)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <Button type="submit" aria-disabled={assign.isPending || undefined}>
          Assign
        </Button>
      </form>
      {accounts.isError && <p className="text-sm text-destructive">Staff accounts couldn't be loaded.</p>}
      {problem && (
        <p id={`${id}-problem`} className="text-sm text-destructive">
          {problem}
        </p>
      )}
    </section>
  )
}

function CardList({
  cards,
  canManage,
  onMessage,
}: {
  cards: RfidCard[]
  canManage: boolean
  onMessage: (message: string) => void
}) {
  const revoke = useRevokeCard()

  const run = async (card: RfidCard) => {
    if (revoke.isPending) return
    try {
      await revoke.mutateAsync(card.id)
      onMessage(`Card ${card.uid} no longer works for ${card.employee.full_name}.`)
    } catch (error) {
      onMessage(`Couldn't revoke ${card.uid}: ${problemText(error, "try again.")}`)
    }
  }

  return (
    <ul className="divide-y rounded-lg border bg-card">
      {cards.map((card) => (
        <li key={card.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm">{card.uid}</span>
              <span
                className={cn(
                  "inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium",
                  card.active ? "border-success/40 bg-success/10 text-success" : "border-border bg-muted text-muted-foreground",
                )}
              >
                {card.active ? "Active" : "Revoked"}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {card.employee.full_name}
              {card.employee.status !== "active" && " (account deactivated)"}
            </p>
          </div>
          {canManage && card.active && (
            <Button variant="ghost" className="self-start text-destructive sm:self-auto" onClick={() => run(card)} aria-disabled={revoke.isPending || undefined}>
              Revoke
              <span className="sr-only"> card {card.uid}</span>
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}

function ScanLog({ query }: { query: UseQueryResult<RfidScan[]> }) {
  const now = useNow(5000)
  return (
    <section aria-labelledby="rfid-scans" className="space-y-3">
      <div>
        <h2 id="rfid-scans" className="text-base font-semibold">
          Recent taps
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Every card tapped on a station, newest first. Refreshes every 10 seconds.</p>
      </div>
      {query.isPending ? (
        <p className="text-sm text-muted-foreground">Loading taps…</p>
      ) : query.isError ? (
        <p className="text-sm text-destructive">{problemText(query.error, "Taps couldn't be loaded.")}</p>
      ) : query.data.length === 0 ? (
        <p className="text-sm text-muted-foreground">No cards tapped yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">When</th>
                <th scope="col" className="px-4 py-2 font-medium">Card</th>
                <th scope="col" className="px-4 py-2 font-medium">Result</th>
                <th scope="col" className="px-4 py-2 font-medium">Holder</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {query.data.map((scan) => (
                <tr key={scan.id}>
                  <td className="px-4 py-2 whitespace-nowrap">{formatAge(scan.scanned_at, now)}</td>
                  <td className="px-4 py-2 font-mono whitespace-nowrap">{scan.uid}</td>
                  <td className={cn("px-4 py-2 whitespace-nowrap", scan.granted ? "text-success" : "text-muted-foreground")}>
                    {SCAN_RESULT_LABELS[scan.result]}
                  </td>
                  <td className="px-4 py-2">{scan.employee_name ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
