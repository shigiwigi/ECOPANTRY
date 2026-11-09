import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useState, type FormEvent } from "react"
import { useForm } from "react-hook-form"
import { Link, Navigate, useLocation, useNavigate } from "react-router"
import { z } from "zod"

import { Logo } from "@/components/common/Logo"
import { RouteLoading } from "@/components/common/RouteLoading"
import { MAIN_CONTENT_ID, SkipLink } from "@/components/common/SkipLink"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ApiError, apiRequest } from "@/lib/api/client"
import { useAuth } from "./auth-context"
import { ThemeMenu } from "@/features/theme/ThemeMenu"
import { useDocumentTitle } from "@/lib/document-title"
import {
  completeGoogleRedirect,
  firebaseErrorCode,
  GoogleSignInUnavailable,
  returningFromGoogleRedirect,
  signInWithGoogle,
  signOutOfGoogle,
} from "@/lib/firebase"

const formSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
})

type FormValues = z.infer<typeof formSchema>

/** Codes for which the Google account is real but isn't an active staff account. */
const NOT_STAFF_CODES = new Set(["google_account_not_staff", "account_disabled"])

const UNREACHABLE = "Can't reach the EcoPantry server, so sign-in isn't available right now. Try again shortly."

export default function SignInPage() {
  const { user, status, endReason, checkSession, signIn, setSession } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [formError, setFormError] = useState<string | null>(null)
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false)
  const [isExchangingSession, setIsExchangingSession] = useState(false)

  useDocumentTitle("Staff sign-in", "portal")

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { email: "", password: "" },
  })

  // Silent session check in the background (non-blocking)
  useEffect(() => {
    if (status === "unknown") {
      checkSession()
    }
  }, [status, checkSession])

  const destination = (location.state as { from?: string } | null)?.from ?? "/portal"

  /** Turns a failed Google sign-in into a message, or sends the person to the "not linked" page. */
  const handleGoogleFailure = async (error: unknown) => {
    if (error instanceof ApiError) {
      if (error.code !== null && NOT_STAFF_CODES.has(error.code)) {
        await signOutOfGoogle()
        navigate("/unauthorized", { replace: true })
        return
      }
      setFormError(error.isUnreachable ? UNREACHABLE : error.message)
      return
    }
    if (error instanceof GoogleSignInUnavailable) {
      setFormError("Google sign-in isn't available here. Sign in with your email and password.")
      return
    }
    if (firebaseErrorCode(error) === "auth/popup-closed-by-user") {
      setFormError("The sign-in window was closed before it finished. Try again.")
      return
    }
    setFormError("Google sign-in failed. Try again, or use your email and password.")
  }

  const exchangeGoogleToken = async (idToken: string) => {
    setIsExchangingSession(true)
    const session = await apiRequest<unknown>("/auth/google", { method: "POST", body: { id_token: idToken } })
    await setSession(session)
    navigate(destination, { replace: true })
  }

  // Back from a Google redirect (used when the browser blocked the popup).
  useEffect(() => {
    if (!returningFromGoogleRedirect()) return
    let current = true
    void (async () => {
      try {
        const idToken = await completeGoogleRedirect()
        if (idToken && current) await exchangeGoogleToken(idToken)
      } catch (error) {
        if (current) await handleGoogleFailure(error)
      } finally {
        if (current) setIsExchangingSession(false)
      }
    })()
    return () => {
      current = false
    }
    // Runs once on arrival; the helpers only close over stable values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Only block when exchanging an active login token; don't block on background status check
  if (isExchangingSession) return <RouteLoading />
  if (user) return <Navigate to={destination} replace />

  const submit = handleSubmit(async (values) => {
    setFormError(null)
    try {
      await signIn({ email: values.email.trim().toLowerCase(), password: values.password })
      navigate(destination, { replace: true })
    } catch (error) {
      if (error instanceof ApiError) {
        // The backend's own wording for invalid_credentials, account_disabled and account_locked.
        setFormError(error.isUnreachable ? UNREACHABLE : error.message)
      } else {
        setFormError("Sign-in failed because the server sent an unexpected response.")
      }
    }
  })

  const handleGoogleSignIn = async () => {
    setFormError(null)
    setIsGoogleSubmitting(true)
    try {
      const idToken = await signInWithGoogle()
      if (idToken) await exchangeGoogleToken(idToken)
    } catch (error) {
      await handleGoogleFailure(error)
    } finally {
      setIsGoogleSubmitting(false)
      setIsExchangingSession(false)
    }
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (isSubmitting || isGoogleSubmitting) {
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
          <h1 className="text-2xl font-semibold tracking-tight">
            Staff sign-in
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            For bakery staff and inspectors. Customers don't need an account. Accounts are created by an administrator.
          </p>

          <div className="mt-6 space-y-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleGoogleSignIn}
              disabled={isSubmitting || isGoogleSubmitting || isExchangingSession}
              className="flex h-10 w-full items-center justify-center gap-2 border-border font-medium shadow-sm transition hover:bg-muted/50"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>{isGoogleSubmitting ? "Connecting to Google…" : "Continue with Google"}</span>
            </Button>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">Or with email</span>
              </div>
            </div>

            <form onSubmit={onSubmit} noValidate className="space-y-4">
              {endReason === "session_ended" && !formError && (
                <p role="status" className="rounded-md border border-info/40 bg-info/10 px-3 py-2 text-sm text-foreground">
                  Your session has ended. Sign in again to continue.
                </p>
              )}
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

              <Button
                type="submit"
                className="h-9 w-full aria-disabled:opacity-70"
                aria-disabled={isSubmitting || isGoogleSubmitting || isExchangingSession || undefined}
              >
                {isSubmitting ? "Signing in…" : "Sign in"}
              </Button>
            </form>
          </div>
        </div>
      </main>
    </div>
  )
}