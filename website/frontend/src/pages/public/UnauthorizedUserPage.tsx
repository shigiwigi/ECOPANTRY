import { ShieldAlert, ArrowLeft, LogOut } from "lucide-react"
import { Link, useNavigate } from "react-router"
import { Logo } from "@/components/common/Logo"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/features/auth/auth-context"

export default function UnauthorizedUserPage() {
  const { signOut, user } = useAuth()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    try {
      await signOut()
      navigate("/", { replace: true })
    } catch {
      navigate("/", { replace: true })
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex h-16 items-center justify-between border-b px-4 sm:px-8">
        <Link to="/" className="text-primary">
          <Logo />
        </Link>
        <Button variant="ghost" size="sm" onClick={handleSignOut} className="gap-2">
          <LogOut className="size-4" />
          <span>Exit to Home</span>
        </Button>
      </header>

      <main className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-6 rounded-xl border bg-card p-8 shadow-sm">
          <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldAlert className="size-8" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              No permissions for ordinary users
            </h1>
            <p className="text-sm text-muted-foreground">
              {user?.email ? (
                <>Signed in as <strong className="text-foreground">{user.email}</strong>.<br /></>
              ) : null}
              Access to the EcoPantry Management Portal is restricted to authorized staff members (Administrators, Shopkeepers, and Food Inspectors).
            </p>
          </div>

          <div className="rounded-lg bg-muted/60 p-4 text-left text-xs text-muted-foreground space-y-2">
            <p className="font-semibold text-foreground">About EcoPantry:</p>
            <p>
              EcoPantry tracks bakery batches, expiration audits, temperature monitoring, and inventory movements to eliminate waste and uphold fresh food safety.
            </p>
            <p>
              If you believe you should have access, contact your bakery administrator to authorize your email address.
            </p>
          </div>

          <div className="pt-2 flex flex-col sm:flex-row gap-3">
            <Button asChild variant="outline" className="w-full">
              <Link to="/" className="gap-2">
                <ArrowLeft className="size-4" />
                Return to Website
              </Link>
            </Button>
          </div>
        </div>
      </main>
    </div>
  )
}