import { zodResolver } from "@hookform/resolvers/zod"
import { useId, useState } from "react"
import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { ApiError } from "@/lib/api/client"
import { contactFormSchema, sendEnquiry, type ContactFormValues } from "./public"

type Outcome = { kind: "sent" } | { kind: "limited" } | { kind: "error"; message: string } | null

function outcomeFor(error: unknown): Outcome {
  if (error instanceof ApiError && error.status === 429) return { kind: "limited" }
  if (error instanceof ApiError && error.isUnreachable) {
    return { kind: "error", message: "We can't reach the server right now. Nothing was sent. Please try again in a moment." }
  }
  if (error instanceof ApiError && error.status === 400) return { kind: "error", message: error.message }
  return { kind: "error", message: "Something went wrong and your message wasn't sent. Please try again." }
}

export function ContactForm() {
  const id = useId()
  const [outcome, setOutcome] = useState<Outcome>(null)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormValues>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: { name: "", email: "", message: "", website: "" },
  })

  const submit = handleSubmit(async (values) => {
    setOutcome(null)
    try {
      await sendEnquiry(values)
      reset()
      setOutcome({ kind: "sent" })
    } catch (error) {
      setOutcome(outcomeFor(error))
    }
  })

  const field = (name: "name" | "email" | "message") => ({
    id: `${id}-${name}`,
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${id}-${name}-error` : undefined,
  })
  const error = (name: "name" | "email" | "message") =>
    errors[name] && (
      <p id={`${id}-${name}-error`} className="text-sm text-destructive">
        {errors[name]?.message}
      </p>
    )

  return (
    <section aria-labelledby={`${id}-title`} className="mt-12 max-w-xl border-t-2 border-gold pt-6">
      <h2 id={`${id}-title`} className="font-display text-2xl font-semibold tracking-tight">
        Send us a message
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Ask about our products or an order. We'll reply by email. Your name and email are used only to answer you and are
        deleted after 12 months.
      </p>

      <div role="status" aria-live="polite">
        {outcome?.kind === "sent" && (
          <p className="mt-4 rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm">
            Thank you. Your message has been sent and we'll get back to you by email.
          </p>
        )}
      </div>
      <div role="alert">
        {outcome?.kind === "limited" && (
          <p className="mt-4 rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-sm">
            You've sent several messages recently. Please wait a while before sending another.
          </p>
        )}
        {outcome?.kind === "error" && (
          <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {outcome.message}
          </p>
        )}
      </div>

      <form onSubmit={submit} noValidate className="relative mt-6 space-y-5">
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-name`}>Your name</Label>
          <Input autoComplete="name" {...field("name")} {...register("name")} />
          {error("name")}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-email`}>Email address</Label>
          <Input type="email" autoComplete="email" {...field("email")} {...register("email")} />
          {error("email")}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-message`}>Message</Label>
          <Textarea className="min-h-32" {...field("message")} {...register("message")} />
          {error("message")}
        </div>

        {/* Honeypot: off-screen, skipped by keyboard and screen readers. People never fill it in. */}
        <div aria-hidden="true" className="absolute -left-[10000px] h-0 w-0 overflow-hidden">
          <label htmlFor={`${id}-website`}>Leave this field empty</label>
          <input id={`${id}-website`} type="text" tabIndex={-1} autoComplete="off" {...register("website")} />
        </div>

        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Sending…" : "Send message"}
        </Button>
      </form>
    </section>
  )
}
