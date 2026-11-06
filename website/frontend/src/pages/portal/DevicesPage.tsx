import { useQuery } from "@tanstack/react-query"
import { Check, CloudOff, Copy, Cpu, KeyRound, Plus } from "lucide-react"
import { useId, useState, type FormEvent } from "react"
import { EmptyState } from "@/components/common/EmptyState"
import { PageHeader } from "@/components/layout/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getModule } from "@/config/portal-modules"
import { useAuth } from "@/features/auth/auth-context"
import {
  devicesQuery,
  useCreateDevice,
  useDeviceAction,
  useRotateToken,
  type Device,
  type DeviceAction,
  type DeviceWithToken,
} from "@/features/devices/api"
import { formatAge, formatClock } from "@/features/sensors/api"
import { ApiError } from "@/lib/api/client"
import { useNow } from "@/lib/use-now"
import { cn } from "@/lib/utils"

function problemText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.isUnreachable) return "Can't reach the EcoPantry server."
  if (error instanceof ApiError) return error.message
  return fallback
}

export default function DevicesPage() {
  const module = getModule("devices")
  const { isPreview } = useAuth()

  return (
    <div className="space-y-6">
      <PageHeader title={module.title} description={module.summary} />
      {isPreview ? (
        <EmptyState
          icon={Cpu}
          title="Needs a real sign-in"
          description="The development preview has no account, so the server won't list or change devices."
        />
      ) : (
        <DeviceManager />
      )}
    </div>
  )
}

function DeviceManager() {
  const devices = useQuery(devicesQuery)
  const [issued, setIssued] = useState<{ token: DeviceWithToken; reason: "created" | "rotated" } | null>(null)
  const [message, setMessage] = useState("")

  return (
    <>
      <p role="status" className={cn("text-sm", message ? "rounded-md border border-success/40 bg-success/10 px-3 py-2" : "sr-only")}>
        {message}
      </p>

      {issued && <TokenReveal issued={issued.token} reason={issued.reason} onDone={() => setIssued(null)} />}

      <RegisterForm
        onCreated={(token) => {
          setMessage("")
          setIssued({ token, reason: "created" })
        }}
      />

      <section aria-labelledby="devices-list" className="space-y-3">
        <h2 id="devices-list" className="text-base font-semibold">
          Stations
        </h2>
        {devices.isPending ? (
          <p className="text-sm text-muted-foreground">Loading devices…</p>
        ) : devices.isError ? (
          <EmptyState icon={CloudOff} title="Devices couldn't be loaded" description={problemText(devices.error, "")}>
            <Button variant="outline" size="sm" onClick={() => devices.refetch()}>
              Try again
            </Button>
          </EmptyState>
        ) : devices.data.length === 0 ? (
          <EmptyState
            icon={Cpu}
            title="No stations registered"
            description="Register the inventory station above to get its token, then put the token in the firmware's include/secrets.h."
          />
        ) : (
          <DeviceList
            devices={devices.data}
            onRotated={(token) => {
              setMessage("")
              setIssued({ token, reason: "rotated" })
            }}
            onMessage={setMessage}
          />
        )}
      </section>
    </>
  )
}

function RegisterForm({ onCreated }: { onCreated: (token: DeviceWithToken) => void }) {
  const id = useId()
  const create = useCreateDevice()
  const [name, setName] = useState("")
  const [problem, setProblem] = useState<string | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (create.isPending) return
    const trimmed = name.trim()
    if (!trimmed) {
      setProblem("Enter a name for the station.")
      return
    }
    setProblem(null)
    try {
      onCreated(await create.mutateAsync(trimmed))
      setName("")
    } catch (error) {
      setProblem(problemText(error, "The station couldn't be registered."))
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-md flex-col gap-1.5">
      <Label htmlFor={`${id}-name`}>Register a station</Label>
      <div className="flex gap-2">
        <Input
          id={`${id}-name`}
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={80}
          placeholder="Inventory station 1"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${id}-problem` : undefined}
        />
        <Button type="submit" aria-disabled={create.isPending || undefined}>
          <Plus aria-hidden />
          Register
        </Button>
      </div>
      {problem && (
        <p id={`${id}-problem`} className="text-sm text-destructive">
          {problem}
        </p>
      )}
    </form>
  )
}

function TokenReveal({
  issued,
  reason,
  onDone,
}: {
  issued: DeviceWithToken
  reason: "created" | "rotated"
  onDone: () => void
}) {
  const [copied, setCopied] = useState(false)
  const headingId = useId()

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.token)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <section aria-labelledby={headingId} className="space-y-3 rounded-lg border border-gold/60 bg-card p-4">
      <div className="flex items-start gap-3">
        <KeyRound className="mt-0.5 size-5 shrink-0 text-gold" aria-hidden />
        <div className="min-w-0 space-y-1">
          <h2 id={headingId} className="font-medium">
            {reason === "created" ? `Token for ${issued.device.name}` : `New token for ${issued.device.name}`}
          </h2>
          <p className="text-sm text-muted-foreground">
            Copy it now: it is shown only once and can't be read back. Put it in the firmware's{" "}
            <code className="font-mono text-xs">include/secrets.h</code> as <code className="font-mono text-xs">DEVICE_TOKEN</code>
            {reason === "rotated" && ". The old token stopped working, so reflash the station"}.
          </p>
        </div>
      </div>
      <p className="overflow-x-auto rounded-md border bg-muted px-3 py-2 font-mono text-sm break-all select-all">{issued.token}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={copy}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
          {copied ? "Copied" : "Copy token"}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          I've saved it
        </Button>
      </div>
    </section>
  )
}

const ACTION_TEXT: Record<DeviceAction, { button: string; done: (name: string) => string }> = {
  "stop-live": { button: "Stop live session", done: (name) => `${name} will pause on its next upload.` },
  disable: { button: "Disable", done: (name) => `${name} is disabled; the server refuses everything it sends.` },
  enable: { button: "Enable", done: (name) => `${name} is enabled again.` },
}

function DeviceList({
  devices,
  onRotated,
  onMessage,
}: {
  devices: Device[]
  onRotated: (token: DeviceWithToken) => void
  onMessage: (message: string) => void
}) {
  const now = useNow(5000)
  const rotate = useRotateToken()
  const act = useDeviceAction()
  const [confirming, setConfirming] = useState<string | null>(null)
  const busy = rotate.isPending || act.isPending

  const runAction = async (device: Device, action: DeviceAction) => {
    if (busy) return
    try {
      await act.mutateAsync({ id: device.id, action })
      onMessage(ACTION_TEXT[action].done(device.name))
    } catch (error) {
      onMessage(`Couldn't change ${device.name}: ${problemText(error, "try again.")}`)
    }
  }

  const runRotate = async (device: Device) => {
    if (busy) return
    setConfirming(null)
    try {
      onRotated(await rotate.mutateAsync(device.id))
    } catch (error) {
      onMessage(`Couldn't rotate the token for ${device.name}: ${problemText(error, "try again.")}`)
    }
  }

  return (
    <ul className="divide-y rounded-lg border bg-card">
      {devices.map((device) => (
        <li key={device.id} className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{device.name}</span>
              <DeviceBadge device={device} />
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
              <dt>Last seen</dt>
              <dd>{device.last_seen_at ? formatAge(device.last_seen_at, now) : "Never"}</dd>
              <dt>Last reading</dt>
              <dd>{device.last_reading_at ? formatAge(device.last_reading_at, now) : "Never"}</dd>
              <dt>Firmware</dt>
              <dd className="font-mono text-xs leading-5">{device.firmware_version ?? "Not reported"}</dd>
              <dt>Token</dt>
              <dd className="font-mono text-xs leading-5">{device.token_prefix}…</dd>
            </dl>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {device.live && (
              <Button variant="outline" onClick={() => runAction(device, "stop-live")} aria-disabled={busy || undefined}>
                {ACTION_TEXT["stop-live"].button}
                <span className="sr-only"> for {device.name}</span>
              </Button>
            )}
            {confirming === device.id ? (
              <div role="group" aria-label={`Confirm new token for ${device.name}`} className="flex flex-wrap items-center gap-2 text-sm">
                <span>The station stops working until it's reflashed.</span>
                <Button variant="destructive" onClick={() => runRotate(device)} aria-disabled={busy || undefined}>
                  Rotate token
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(null)}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button variant="outline" onClick={() => setConfirming(device.id)}>
                New token
                <span className="sr-only"> for {device.name}</span>
              </Button>
            )}
            <Button
              variant="ghost"
              className={cn(device.status === "active" && "text-destructive")}
              onClick={() => runAction(device, device.status === "active" ? "disable" : "enable")}
              aria-disabled={busy || undefined}
            >
              {device.status === "active" ? "Disable" : "Enable"}
              <span className="sr-only"> {device.name}</span>
            </Button>
          </div>
        </li>
      ))}
    </ul>
  )
}

function DeviceBadge({ device }: { device: Device }) {
  const [label, tone] =
    device.status === "disabled"
      ? ["Disabled", "border-destructive/40 bg-destructive/10 text-destructive"]
      : device.live
        ? [`Live until ${device.live_until ? formatClock(device.live_until) : "…"}`, "border-success/40 bg-success/10 text-success"]
        : ["Paused", "border-border bg-muted text-muted-foreground"]
  return (
    <span className={cn("inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs font-medium", tone)}>{label}</span>
  )
}
