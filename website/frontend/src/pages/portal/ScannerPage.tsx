import { ShieldCheck } from "lucide-react"
import { useEffect, useId, useRef, useState, type FormEvent } from "react"
import { PageHeader } from "@/components/layout/PageHeader"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getModule } from "@/config/portal-modules"
import { formatCode, READ_PROBLEMS, readTypedLabel } from "@/features/qr/batch-label"
import { BatchLookup } from "@/features/qr/BatchLookup"
import { QrScanner } from "@/features/qr/QrScanner"

interface LabelRead {
  code: string
  source: "camera" | "typed"
  /** Distinguishes reading the same label twice, so the lookup runs again. */
  at: number
}

export default function ScannerPage() {
  const module = getModule("scanner")
  const id = useId()
  const [read, setRead] = useState<LabelRead | null>(null)
  const resultHeading = useRef<HTMLHeadingElement>(null)

  // After a camera scan, take keyboard and screen-reader focus (and small screens) to the result.
  useEffect(() => {
    if (read?.source === "camera") resultHeading.current?.focus()
  }, [read])

  return (
    <div className="space-y-6">
      <PageHeader title={module.title} description={module.summary} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <QrScanner hasResult={read !== null} onCode={(code) => setRead({ code, source: "camera", at: Date.now() })} />

        <div className="min-w-0 space-y-6">
          <ManualEntry onCode={(code) => setRead({ code, source: "typed", at: Date.now() })} />

          <section aria-labelledby={`${id}-result`} className="rounded-lg border bg-card">
            <h2
              id={`${id}-result`}
              ref={resultHeading}
              tabIndex={-1}
              className="border-b px-4 py-3 text-sm font-semibold outline-none focus-visible:outline-2 focus-visible:-outline-offset-2"
            >
              Batch
            </h2>
            <div className="space-y-3 p-4">
              {read ? (
                <>
                  <p className="text-sm">
                    <span className="text-muted-foreground">{read.source === "camera" ? "Scanned" : "Entered"} label </span>
                    <span className="font-mono font-medium">{formatCode(read.code)}</span>
                  </p>
                  <BatchLookup key={read.at} code={read.code} />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Scan a label or enter its code to see the batch here.</p>
              )}
            </div>
          </section>

          <p className="flex gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Labels carry only a batch code. What a scan shows depends on your account's permissions, and scanning
              never changes stock.
            </span>
          </p>
        </div>
      </div>
    </div>
  )
}

/** Fallback for when the camera can't be used, or the QR code is damaged. */
function ManualEntry({ onCode }: { onCode: (code: string) => void }) {
  const id = useId()
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const result = readTypedLabel(value)
    if (!result.ok) {
      setError(READ_PROBLEMS[result.reason])
      return
    }
    setError(null)
    setValue(formatCode(result.code))
    onCode(result.code)
  }

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-lg border bg-card">
      <h2 id={`${id}-title`} className="border-b px-4 py-3 text-sm font-semibold">
        Enter a code
      </h2>
      <form onSubmit={submit} noValidate className="space-y-2 p-4">
        <Label htmlFor={`${id}-code`}>Batch code</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={`${id}-code`}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={200}
            placeholder="K7M2Q-9X4TR"
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
            className="h-11 font-mono uppercase placeholder:normal-case sm:h-9"
          />
          <Button type="submit" className="h-11 px-4 sm:h-9">
            Look up
          </Button>
        </div>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          The 10 letters and digits printed under the QR code. Spaces and dashes don't matter.
        </p>
        {error && (
          <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </section>
  )
}
