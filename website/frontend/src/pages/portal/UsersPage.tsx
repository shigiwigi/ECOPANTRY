import { useQuery } from "@tanstack/react-query"
import { CloudOff, UserPlus, Users } from "lucide-react"
import { useId, useState, type FormEvent } from "react"
import { EmptyState } from "@/components/common/EmptyState"
import { PageHeader } from "@/components/layout/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { NativeSelect } from "@/components/ui/native-select"
import { getModule } from "@/config/portal-modules"
import { useAuth } from "@/features/auth/auth-context"
import { isRole, ROLE_LABELS, ROLES, type Role } from "@/features/auth/roles"
import {
  employeesQuery,
  INITIAL_PASSWORD_MAX,
  INITIAL_PASSWORD_MIN,
  useChangeRole,
  useCreateEmployee,
  useResetPassword,
  useSetActive,
  type AccountFilter,
  type ManagedEmployee,
} from "@/features/employees/api"
import { ApiError } from "@/lib/api/client"
import { cn } from "@/lib/utils"

function problemText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.isUnreachable) return "Can't reach the EcoPantry server."
  if (error instanceof ApiError) return error.message
  return fallback
}

const FILTERS: { value: AccountFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
]

export default function UsersPage() {
  const module = getModule("users")
  const { isPreview } = useAuth()
  const [filter, setFilter] = useState<AccountFilter>("active")
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <div className="space-y-6">
      <PageHeader
        title={module.title}
        description="Staff accounts and what each person can do. Accounts are never deleted: deactivate one to remove access and keep the audit history. If someone signs in with Google and isn't listed here as active, they are turned away; add or reactivate them first."
        actions={
          !isPreview && (
            <Button onClick={() => setAdding((open) => !open)} aria-expanded={adding} className="max-sm:h-10">
              <UserPlus aria-hidden />
              Add account
            </Button>
          )
        }
      />

      {isPreview ? (
        <EmptyState
          icon={Users}
          title="Needs a real sign-in"
          description="The development preview has no account, so the server won't share staff records."
        />
      ) : (
        <>
          {adding && (
            <AddAccount
              onDone={(message) => {
                setAdding(false)
                setNotice(message)
              }}
              onCancel={() => setAdding(false)}
            />
          )}
          {notice && (
            <p role="status" className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-foreground">
              {notice}
            </p>
          )}
          <div role="group" aria-label="Show accounts" className="inline-flex rounded-md border p-0.5">
            {FILTERS.map(({ value, label }) => (
              <Button
                key={value}
                type="button"
                variant={filter === value ? "default" : "ghost"}
                aria-pressed={filter === value}
                onClick={() => {
                  setFilter(value)
                  setNotice(null)
                }}
                className="max-sm:h-9"
              >
                {label}
              </Button>
            ))}
          </div>
          <AccountList filter={filter} onNotice={setNotice} />
        </>
      )}
    </div>
  )
}

function AddAccount({ onDone, onCancel }: { onDone: (message: string) => void; onCancel: () => void }) {
  const id = useId()
  const create = useCreateEmployee()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<Role>("storekeeper")
  const [password, setPassword] = useState("")
  const [problem, setProblem] = useState<string | null>(null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setProblem(null)
    if (!name.trim()) return setProblem("Enter the person's name.")
    if (!email.trim()) return setProblem("Enter their email address.")
    if (password && (password.length < INITIAL_PASSWORD_MIN || password.length > INITIAL_PASSWORD_MAX)) {
      return setProblem(`An initial password needs ${INITIAL_PASSWORD_MIN} to ${INITIAL_PASSWORD_MAX} characters.`)
    }
    create.mutate(
      { name: name.trim(), email: email.trim(), role, ...(password ? { password } : {}) },
      {
        onSuccess: (account) => onDone(`Added ${account.name} as ${ROLE_LABELS[account.role]}.`),
        onError: (error) => setProblem(problemText(error, "The account couldn't be added.")),
      },
    )
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-lg border bg-card p-4 sm:p-5">
      <h2 className="font-semibold">New staff account</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-name`}>Name</Label>
          <Input id={`${id}-name`} value={name} autoComplete="off" onChange={(event) => setName(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-email`}>Email</Label>
          <Input
            id={`${id}-email`}
            type="email"
            value={email}
            autoComplete="off"
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-role`}>Role</Label>
          <NativeSelect id={`${id}-role`} value={role} onChange={(event) => isRole(event.target.value) && setRole(event.target.value)}>
            {ROLES.map((code) => (
              <option key={code} value={code}>
                {ROLE_LABELS[code]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-password`}>Initial password (optional)</Label>
          <Input
            id={`${id}-password`}
            type="password"
            value={password}
            autoComplete="new-password"
            aria-describedby={`${id}-password-hint`}
            onChange={(event) => setPassword(event.target.value)}
          />
          <p id={`${id}-password-hint`} className="text-xs text-muted-foreground">
            {INITIAL_PASSWORD_MIN} to {INITIAL_PASSWORD_MAX} characters. Tell them in person. Leave it empty if they will
            only use Google sign-in.
          </p>
        </div>
      </div>
      {problem && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {problem}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={create.isPending} className="max-sm:h-10">
          {create.isPending ? "Adding…" : "Add account"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} className="max-sm:h-10">
          Cancel
        </Button>
      </div>
    </form>
  )
}

function AccountList({ filter, onNotice }: { filter: AccountFilter; onNotice: (message: string | null) => void }) {
  const accounts = useQuery(employeesQuery(filter))
  const { user } = useAuth()

  if (accounts.isPending) return <p className="text-sm text-muted-foreground">Loading accounts…</p>
  if (accounts.isError) {
    const unreachable = accounts.error instanceof ApiError && accounts.error.isUnreachable
    return (
      <EmptyState
        icon={CloudOff}
        title={unreachable ? "Can't reach the EcoPantry server" : "Accounts couldn't be loaded"}
        description={unreachable ? "Check the connection and try again." : problemText(accounts.error, "Try again shortly.")}
      >
        <Button variant="outline" onClick={() => void accounts.refetch()} className="max-sm:h-10">
          Try again
        </Button>
      </EmptyState>
    )
  }
  if (accounts.data.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={filter === "active" ? "No active accounts" : "No inactive accounts"}
        description={filter === "inactive" ? "Deactivated accounts appear here and can be reactivated." : undefined}
      />
    )
  }

  return (
    <ul aria-label={`${filter === "active" ? "Active" : "Inactive"} accounts`} className="divide-y rounded-lg border bg-card">
      {accounts.data.map((account) => (
        <AccountRow key={account.id} account={account} isSelf={account.id === user?.id} onNotice={onNotice} />
      ))}
    </ul>
  )
}

type Panel = "deactivate" | "reactivate" | "password" | null

function AccountRow({
  account,
  isSelf,
  onNotice,
}: {
  account: ManagedEmployee
  isSelf: boolean
  onNotice: (message: string | null) => void
}) {
  const id = useId()
  const changeRole = useChangeRole()
  const setActive = useSetActive()
  const resetPassword = useResetPassword()
  const [panel, setPanel] = useState<Panel>(null)
  const [password, setPassword] = useState("")
  const [problem, setProblem] = useState<string | null>(null)
  const active = account.status === "active"

  const open = (next: Panel) => {
    setPanel(next)
    setPassword("")
    setProblem(null)
    onNotice(null)
  }

  const onRole = (value: string) => {
    if (!isRole(value) || value === account.role) return
    setProblem(null)
    onNotice(null)
    changeRole.mutate(
      { id: account.id, role: value },
      {
        onSuccess: () => onNotice(`${account.name} is now ${ROLE_LABELS[value]}. They were signed out everywhere.`),
        onError: (error) => setProblem(problemText(error, "The role couldn't be changed.")),
      },
    )
  }

  const confirmActive = () => {
    setActive.mutate(
      { id: account.id, active: !active },
      {
        onSuccess: () => {
          setPanel(null)
          onNotice(active ? `${account.name} was deactivated and signed out everywhere.` : `${account.name} can sign in again.`)
        },
        onError: (error) => setProblem(problemText(error, "The change couldn't be saved.")),
      },
    )
  }

  const submitPassword = (event: FormEvent) => {
    event.preventDefault()
    setProblem(null)
    if (password.length < INITIAL_PASSWORD_MIN || password.length > INITIAL_PASSWORD_MAX) {
      return setProblem(`A password needs ${INITIAL_PASSWORD_MIN} to ${INITIAL_PASSWORD_MAX} characters.`)
    }
    resetPassword.mutate(
      { id: account.id, password },
      {
        onSuccess: () => {
          setPanel(null)
          setPassword("")
          onNotice(`New password set for ${account.name}. They were signed out everywhere.`)
        },
        onError: (error) => setProblem(problemText(error, "The password couldn't be changed.")),
      },
    )
  }

  return (
    <li className="space-y-3 p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <span className="truncate">{account.name}</span>
            {isSelf && <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">You</span>}
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-xs font-normal",
                active ? "bg-success/10 text-success" : "bg-muted text-muted-foreground",
              )}
            >
              {active ? "Active" : "Inactive"}
            </span>
          </p>
          <p className="truncate text-sm text-muted-foreground">{account.email}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={`${id}-role`} className="sr-only">
            Role for {account.email}
          </Label>
          <NativeSelect
            id={`${id}-role`}
            value={account.role}
            disabled={isSelf || !active || changeRole.isPending}
            onChange={(event) => onRole(event.target.value)}
            className="w-44 max-sm:h-10"
            title={isSelf ? "You can't change your own role" : undefined}
          >
            {ROLES.map((code) => (
              <option key={code} value={code}>
                {ROLE_LABELS[code]}
              </option>
            ))}
          </NativeSelect>
          {active && (
            <Button variant="outline" onClick={() => open("password")} aria-expanded={panel === "password"} className="max-sm:h-10">
              Reset password
            </Button>
          )}
          {!isSelf && (
            <Button
              variant={active ? "destructive" : "outline"}
              onClick={() => open(active ? "deactivate" : "reactivate")}
              aria-expanded={panel === "deactivate" || panel === "reactivate"}
              className="max-sm:h-10"
            >
              {active ? "Deactivate" : "Reactivate"}
            </Button>
          )}
        </div>
      </div>

      {(panel === "deactivate" || panel === "reactivate") && (
        <div className="flex flex-col gap-2 rounded-md bg-muted/60 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>
            {panel === "deactivate"
              ? `Deactivate ${account.name}? They are signed out everywhere and can't sign in until reactivated.`
              : `Reactivate ${account.name}? They will be able to sign in again.`}
          </p>
          <div className="flex gap-2">
            <Button
              variant={panel === "deactivate" ? "destructive" : "default"}
              disabled={setActive.isPending}
              onClick={confirmActive}
              className="max-sm:h-10"
            >
              {panel === "deactivate" ? "Yes, deactivate" : "Yes, reactivate"}
            </Button>
            <Button variant="ghost" onClick={() => open(null)} className="max-sm:h-10">
              Cancel
            </Button>
          </div>
        </div>
      )}

      {panel === "password" && (
        <form onSubmit={submitPassword} noValidate className="space-y-2 rounded-md bg-muted/60 p-3">
          <Label htmlFor={`${id}-password`}>New password for {account.name}</Label>
          <Input
            id={`${id}-password`}
            type="password"
            value={password}
            autoComplete="new-password"
            onChange={(event) => setPassword(event.target.value)}
            className="max-w-sm"
          />
          <p className="text-xs text-muted-foreground">
            {INITIAL_PASSWORD_MIN} to {INITIAL_PASSWORD_MAX} characters. Tell them in person. This signs them out everywhere.
          </p>
          <div className="flex gap-2">
            <Button type="submit" disabled={resetPassword.isPending} className="max-sm:h-10">
              {resetPassword.isPending ? "Saving…" : "Set password"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => open(null)} className="max-sm:h-10">
              Cancel
            </Button>
          </div>
        </form>
      )}

      {problem && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {problem}
        </p>
      )}
    </li>
  )
}
