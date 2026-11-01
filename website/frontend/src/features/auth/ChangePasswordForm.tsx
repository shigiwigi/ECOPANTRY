import { zodResolver } from "@hookform/resolvers/zod"
import { useId, useState, type FormEvent } from "react"
import { useForm, type FieldError } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, apiRequest } from "@/lib/api/client"
import { changePasswordSchema, PASSWORD_MIN_LENGTH, type ChangePasswordValues } from "./schemas"

function Field({
  id,
  label,
  autoComplete,
  error,
  hint,
  registration,
}: {
  id: string
  label: string
  autoComplete: string
  error?: FieldError
  hint?: string
  registration: ReturnType<ReturnType<typeof useForm<ChangePasswordValues>>["register"]>
}) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="password" autoComplete={autoComplete} aria-invalid={error ? true : undefined} aria-describedby={describedBy} {...registration} />
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error.message}
        </p>
      )}
    </div>
  )
}

/** Changes the signed-in employee's password. The server signs out their other sessions. */
export function ChangePasswordForm() {
  const id = useId()
  const [result, setResult] = useState<{ kind: "error" | "success"; message: string } | null>(null)
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ChangePasswordValues>({ resolver: zodResolver(changePasswordSchema) })

  const submit = handleSubmit(async (values) => {
    setResult(null)
    try {
      await apiRequest<void>("/auth/password", {
        method: "POST",
        body: { current_password: values.currentPassword, new_password: values.newPassword },
      })
      reset()
      setResult({ kind: "success", message: "Password changed. Any other devices signed in to your account were signed out." })
    } catch (error) {
      if (error instanceof ApiError && error.isUnreachable) {
        setResult({ kind: "error", message: "Can't reach the EcoPantry server. Your password hasn't changed." })
      } else if (error instanceof ApiError) {
        setResult({ kind: "error", message: error.message })
      } else {
        setResult({ kind: "error", message: "The password couldn't be changed. Try again." })
      }
    }
  })

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (isSubmitting) {
      event.preventDefault()
      return
    }
    return submit(event)
  }

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-sm space-y-4" aria-labelledby={`${id}-title`}>
      <div>
        <h2 id={`${id}-title`} className="text-base font-semibold">
          Password
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">Changing it signs you out on every other device.</p>
      </div>

      {result && (
        <p
          role={result.kind === "error" ? "alert" : "status"}
          className={
            result.kind === "error"
              ? "rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              : "rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm text-foreground"
          }
        >
          {result.message}
        </p>
      )}

      <Field id={`${id}-current`} label="Current password" autoComplete="current-password" error={errors.currentPassword} registration={register("currentPassword")} />
      <Field
        id={`${id}-new`}
        label="New password"
        autoComplete="new-password"
        hint={`At least ${PASSWORD_MIN_LENGTH} characters. A few unrelated words work well.`}
        error={errors.newPassword}
        registration={register("newPassword")}
      />
      <Field id={`${id}-confirm`} label="Repeat new password" autoComplete="new-password" error={errors.confirmPassword} registration={register("confirmPassword")} />

      <Button type="submit" className="aria-disabled:opacity-70" aria-disabled={isSubmitting || undefined}>
        {isSubmitting ? "Changing…" : "Change password"}
      </Button>
    </form>
  )
}
