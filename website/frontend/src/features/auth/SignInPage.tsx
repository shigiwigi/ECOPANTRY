import { zodResolver } from "@hookform/resolvers/zod"
import { useState, type FormEvent } from "react"
import { useForm } from "react-hook-form"
import { Link, Navigate, useLocation, useNavigate } from "react-router"
import { Logo } from "@/components/common/Logo"
import { MAIN_CONTENT_ID, SkipLink } from "@/components/common/SkipLink"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError } from "@/lib/api/client"
import { useAuth } from "./auth-context"
import { signInSchema, type SignInValues } from "./schemas"
import { ThemeMenu } from "@/features/theme/ThemeMenu"
import { useDocumentTitle } from "@/lib/document-title"

export default function SignInPage() {
  const { user, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [formError, setFormError] = useState<string | null>(null)
  useDocumentTitle("Staff sign-in", "portal")

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInValues>({ resolver: zodResolver(signInSchema) })

  const destination = (location.state as { from?: string } | null)?.from ?? "/portal"
  if (user) return <Navigate to={destination} replace />

  const submit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await signIn(values)
      navigate(destination, { replace: true })
    } catch (error) {
      if (error instanceof ApiError && error.isUnreachable) {
        setFormError("Can't reach the EcoPantry server, so sign-in isn't available right now. Try again shortly.")
      } else if (error instanceof ApiError && error.status === 401) {
        setFormError("That email and password don't match an account.")
      } else if (error instanceof ApiError) {
        setFormError(error.message)
      } else {
        setFormError("Sign-in failed because the server sent an unexpected response.")
      }
    }
  })

  // The button stays focusable while submitting (aria-disabled, not disabled) so
  // keyboard focus isn't dropped to the page; repeat submits are ignored here.
  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (isSubmitting) {
      event.preventDefault()
      return
    }
    return submit(event)
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <SkipLink />
      <header className="flex h-14 items-center justify-between border-b px-4 sm:px-6">
        <Link to="/" className="rounded-md text-primary" aria-label="EcoPantry home">
          <Logo />
        </Link>
        <ThemeMenu />
      </header>
      <main id={MAIN_CONTENT_ID} tabIndex={-1} className="grid flex-1 place-items-center px-4 py-10 outline-none">
        <div className="w-full max-w-sm">
          <h1 className="text-2xl font-semibold tracking-tight">Staff sign-in</h1>
          <p className="mt-1 text-sm text-muted-foreground">For bakery staff and inspectors. Customers don't need an account.</p>

          <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
            {formError && (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {formError}
              </p>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                aria-invalid={errors.email ? true : undefined}
                aria-describedby={errors.email ? "email-error" : undefined}
                {...register("email")}
              />
              {errors.email && (
                <p id="email-error" className="text-sm text-destructive">
                  {errors.email.message}
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                aria-invalid={errors.password ? true : undefined}
                aria-describedby={errors.password ? "password-error" : undefined}
                {...register("password")}
              />
              {errors.password && (
                <p id="password-error" className="text-sm text-destructive">
                  {errors.password.message}
                </p>
              )}
            </div>

            <Button type="submit" className="h-9 w-full aria-disabled:opacity-70" aria-disabled={isSubmitting || undefined}>
              {isSubmitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>
      </main>
    </div>
  )
}
