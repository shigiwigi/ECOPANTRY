import { Link } from "react-router"
import {
  Boxes,
  CalendarClock,
  FileText,
  Package,
  ScanLine,
  Shield,
  ThermometerSun,
  Users,
} from "lucide-react"
import { useAuth } from "@/features/auth/auth-context"
import { ROLE_LABELS } from "@/features/auth/roles"
import { StationSummary } from "@/features/sensors/StationSummary"
import { PageHeader } from "@/components/layout/PageHeader"
import { Button } from "@/components/ui/button"

export default function DashboardPage() {
  const { user } = useAuth()
  const role = user?.role ?? "storekeeper"

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        documentTitle="Dashboard"
        description={
          <>
            <span className="font-medium text-foreground">
              Welcome back, {user?.name || user?.email || "Staff Member"}
            </span>{" "}
            ({ROLE_LABELS[role]}).{" "}
            {role === "admin" && "Full administrative control over users, inventory, hardware, and safety records."}
            {role === "storekeeper" && "Pantry stock monitoring, batch lookups, and ingredient intake management."}
            {role === "inspector" && "Food safety compliance, cold chain logs, and expiration tracking."}
          </>
        }
        actions={
          role === "admin" ? (
            <Button asChild className="gap-2">
              <Link to="/portal/users">
                <Users className="size-4" />
                Manage Users
              </Link>
            </Button>
          ) : undefined
        }
      />

      {/* Real readings from the inventory station, for every role */}
      <StationSummary />

      {/* ADMIN VIEW */}
      {role === "admin" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-sm font-medium">Access Management</span>
                <Users className="size-5 text-primary" />
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold text-foreground">Active Staff</div>
                <p className="text-xs text-muted-foreground mt-1">Configured roles & accounts</p>
              </div>
              <div className="mt-4">
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link to="/portal/users">View Staff Accounts</Link>
                </Button>
              </div>
            </div>

            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-sm font-medium">Inventory</span>
                <Package className="size-5 text-success" />
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold text-foreground">Raw ingredients</div>
                <p className="text-xs text-muted-foreground mt-1">Stock records aren't connected yet</p>
              </div>
              <div className="mt-4">
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link to="/portal/inventory">Open Inventory</Link>
                </Button>
              </div>
            </div>

            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-sm font-medium">Audit & Compliance</span>
                <Shield className="size-5 text-blue-500" />
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold text-foreground">Audit Log</div>
                <p className="text-xs text-muted-foreground mt-1">Immutable change records</p>
              </div>
              <div className="mt-4">
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link to="/portal/audit">Inspect Actions</Link>
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SHOPKEEPER VIEW */}
      {role === "storekeeper" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border bg-card p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-muted-foreground mb-2">
                  <span className="text-sm font-medium">Quick Scan</span>
                  <ScanLine className="size-5 text-primary" />
                </div>
                <div className="text-xl font-bold text-foreground">Batch Scanner</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Scan incoming ingredients or verify batch codes using your device camera.
                </p>
              </div>
              <Button asChild className="mt-4 w-full gap-2">
                <Link to="/portal/scan">
                  <ScanLine className="size-4" />
                  Launch Scanner
                </Link>
              </Button>
            </div>

            <div className="rounded-xl border bg-card p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-muted-foreground mb-2">
                  <span className="text-sm font-medium">Stock Levels</span>
                  <Package className="size-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div className="text-xl font-bold text-foreground">Current Stock</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Check available raw bakery materials, units, and reorder levels.
                </p>
              </div>
              <Button asChild variant="outline" className="mt-4 w-full">
                <Link to="/portal/inventory">Review Inventory</Link>
              </Button>
            </div>

            <div className="rounded-xl border bg-card p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-muted-foreground mb-2">
                  <span className="text-sm font-medium">Batch Labels</span>
                  <Boxes className="size-5 text-amber-500" />
                </div>
                <div className="text-xl font-bold text-foreground">Generate Labels</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Create and print printable QR labels for freshly received ingredient containers.
                </p>
              </div>
              <Button asChild variant="outline" className="mt-4 w-full">
                <Link to="/portal/qr">Create QR Labels</Link>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* FOOD INSPECTOR VIEW */}
      {role === "inspector" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border bg-card p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-muted-foreground mb-2">
                  <span className="text-sm font-medium">Storage Safety</span>
                  <ThermometerSun className="size-5 text-amber-500" />
                </div>
                <div className="text-xl font-bold text-foreground">Temperature Logs</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Monitor cold storage telemetry, historical temperature readings, and breach events.
                </p>
              </div>
              <Button asChild className="mt-4 w-full gap-2">
                <Link to="/portal/environment">
                  <ThermometerSun className="size-4" />
                  Check Temperature
                </Link>
              </Button>
            </div>

            <div className="rounded-xl border bg-card p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-muted-foreground mb-2">
                  <span className="text-sm font-medium">Expiry Audits</span>
                  <CalendarClock className="size-5 text-destructive" />
                </div>
                <div className="text-xl font-bold text-foreground">FEFO Verification</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Verify First-Expired, First-Out compliance and identify batches nearing expiration.
                </p>
              </div>
              <Button asChild variant="outline" className="mt-4 w-full">
                <Link to="/portal/expiry">Inspect Batches</Link>
              </Button>
            </div>

            <div className="rounded-xl border bg-card p-5 shadow-sm flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between text-muted-foreground mb-2">
                  <span className="text-sm font-medium">Compliance Reports</span>
                  <FileText className="size-5 text-blue-500" />
                </div>
                <div className="text-xl font-bold text-foreground">Safety Reports</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Generate and export compliance reports for official food safety records.
                </p>
              </div>
              <Button asChild variant="outline" className="mt-4 w-full">
                <Link to="/portal/reports">Open Reports</Link>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}