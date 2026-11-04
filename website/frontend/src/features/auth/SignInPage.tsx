import { zodResolver } from "@hookform/resolvers/zod"
import { useEffect, useState, type FormEvent } from "react"
import { useForm } from "react-hook-form"
import { Link, Navigate, useLocation, useNavigate } from "react-router"
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
} from "firebase/auth"
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
import { auth, googleProvider } from "@/lib/firebase"

const formSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
  confirmPassword: z.string().optional(),
})

type FormValues = z.infer<typeof formSchema>

export default function SignInPage() {
  const { user, status, endReason, checkSession, signIn, setSession } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [isSignUp, setIsSignUp] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false)
  const [isExchangingSession, setIsExchangingSession] = useState(false)

  useDocumentTitle(isSignUp ? "Create account" : "Staff sign-in", "portal")

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: "",
      password: "",
      confirmPassword: "",
    },
  })

  // Silent session check in the background (non-blocking)
  useEffect(() => {
    if (status === "unknown") {
      checkSession()
    }
  }, [status, checkSession])

  const destination = (location.state as { from?: string } | null)?.from ?? "/portal"

  // Process redirect result if redirected by mobile fallback
  useEffect(() => {
    if (!auth) return

    let isMounted = true
    const handleRedirectResult = async () => {
      try {
        const result = await getRedirectResult(auth)
        if (result && isMounted) {
          setIsExchangingSession(true)
          const idToken = await result.user.getIdToken()
          const sessionResponse = await apiRequest("/auth/google", {
            method: "POST",
            body: { id_token: idToken },
          })
          if (setSession) {
            await setSession(sessionResponse)
          }
          navigate(destination, { replace: true })
        }
      } catch (error: any) {
        if (!isMounted) return
        console.error("Redirect auth error:", error)
        if (error instanceof ApiError) {
          setFormError(error.message)
        } else {
          setFormError(error?.message?.replace("Firebase: ", "") || "Google sign-in failed.")
        }
      } finally {
        if (isMounted) {
          setIsGoogleSubmitting(false)
          setIsExchangingSession(false)
        }
      }
    }

    void handleRedirectResult()
    return () => {
      isMounted = false
    }
  }, [destination, navigate, setSession])

  // Only block when exchanging an active login token; don't block on background status check
  if (isExchangingSession) return <RouteLoading />
  if (user) return <Navigate to={destination} replace />

  const submit = handleSubmit(async (values) => {
    setFormError(null)

    if (isSignUp) {
      if (!values.confirmPassword) {
        setFormError("Please confirm your password.")
        return
      }
      if (values.password !== values.confirmPassword) {
        setFormError("Passwords do not match.")
        return
      }
      if (values.password.length < 6) {
        setFormError("Password must be at least 6 characters.")
        return
      }
    }

    try {
      if (isSignUp) {
        const registerResponse = await apiRequest("/auth/register", {
          method: "POST",
          body: {
            email: values.email,
            password: values.password,
          },
        })
        if (setSession) {
          await setSession(registerResponse)
        }
      } else {
        await signIn({ email: values.email, password: values.password })
      }
      navigate(destination, { replace: true })
    } catch (error) {
      if (error instanceof ApiError && error.isUnreachable) {
        setFormError("Can't reach the EcoPantry server, so sign-in isn't available right now. Try again shortly.")
      } else if (error instanceof ApiError && error.status === 401) {
        setFormError("That email and password don't match an account.")
      } else if (error instanceof ApiError) {
        setFormError(error.message)
      } else {
        setFormError(isSignUp ? "Sign-up failed. Try again shortly." : "Sign-in failed because the server sent an unexpected response.")
      }
    }
  })

  const handleGoogleSignIn = async () => {
    setFormError(null)
    setIsGoogleSubmitting(true)

    try {
      if (!auth) {
        throw new Error("Firebase Auth is not properly initialized. Check your environment settings.")
      }

      googleProvider.setCustomParameters({
        prompt: "select_account",
      })

      let idToken: string | null = null

      try {
        const result = await signInWithPopup(auth, googleProvider)
        idToken = await result.user.getIdToken()
      } catch (popupErr: any) {
        if (
          popupErr?.code === "auth/popup-blocked" ||
          popupErr?.code === "auth/cancelled-popup-request"
        ) {
          await signInWithRedirect(auth, googleProvider)
          return
        }
        throw popupErr
      }

      if (idToken) {
        setIsExchangingSession(true)

        const sessionResponse = await apiRequest("/auth/google", {
          method: "POST",
          body: { id_token: idToken },
        })

        if (setSession) {
          await setSession(sessionResponse)
        }
        navigate(destination, { replace: true })
      }
    } catch (error: any) {
      console.error("Google sign-in caught error:", error)

      if (error?.code === "auth/popup-closed-by-user") {
        setFormError("The sign-in window was closed before completing. Please try again.")
        return
      }

      if (error instanceof ApiError) {
        setFormError(error.message)
      } else {
        const errorMsg = error?.message?.replace("Firebase: ", "") || "Google sign-in failed."
        setFormError(errorMsg)
      }
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

  const toggleAuthMode = () => {
    setIsSignUp((prev) => !prev)
    setFormError(null)
    reset()
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
            {isSignUp ? "Create an account" : "Staff sign-in"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isSignUp
              ? "Create your account to access the pantry inventory and management tools."
              : "For bakery staff and inspectors. Customers don't need an account."}
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
                  autoComplete={isSignUp ? "new-password" : "current-password"}
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

              {isSignUp && (
                <div className="space-y-1.5">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    aria-invalid={errors.confirmPassword ? true : undefined}
                    aria-describedby={errors.confirmPassword ? "confirm-password-error" : undefined}
                    {...register("confirmPassword")}
                  />
                  {errors.confirmPassword && (
                    <p id="confirm-password-error" className="text-sm text-destructive">
                      {errors.confirmPassword.message}
                    </p>
                  )}
                </div>
              )}

              <Button
                type="submit"
                className="h-9 w-full aria-disabled:opacity-70"
                aria-disabled={isSubmitting || isGoogleSubmitting || isExchangingSession || undefined}
              >
                {isSubmitting
                  ? isSignUp
                    ? "Creating account…"
                    : "Signing in…"
                  : isSignUp
                  ? "Create account"
                  : "Sign in"}
              </Button>
            </form>

            <div className="text-center text-sm text-muted-foreground">
              {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
              <button
                type="button"
                onClick={toggleAuthMode}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                {isSignUp ? "Sign in" : "Sign up"}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}