import type { ComponentType } from "react"
import type { RouteObject } from "react-router"
import { RouteError } from "@/components/common/RouteError"
import { RouteLoading } from "@/components/common/RouteLoading"
import { PublicLayout } from "@/components/layout/PublicLayout"
import { PORTAL_MODULES, type PortalModule } from "@/config/portal-modules"
import { RequireAuth } from "@/features/auth/RequireAuth"
import { RequireRole } from "@/features/auth/RequireRole"
import UnauthorizedUserPage from "@/pages/public/UnauthorizedUserPage"

// Custom pages; every other module renders the generic ModulePage until its API exists.
const CUSTOM_PAGES: Record<string, () => Promise<{ default: ComponentType }>> = {
  dashboard: () => import("@/pages/portal/DashboardPage"),
  catalogue: () => import("@/pages/portal/CataloguePage"),
  expiry: () => import("@/pages/portal/ExpiryPage"),
  inventory: () => import("@/pages/portal/InventoryPage"),
  batches: () => import("@/pages/portal/BatchesPage"),
  scanner: () => import("@/pages/portal/ScannerPage"),
  qr: () => import("@/pages/portal/LabelsPage"),
  settings: () => import("@/pages/portal/SettingsPage"),
  users: () => import("@/pages/portal/UsersPage"),
  environment: () => import("@/pages/portal/EnvironmentPage"),
  ph: () => import("@/pages/portal/PhPage"),
  camera: () => import("@/pages/portal/CameraPage"),
  waste: () => import("@/pages/portal/WastePage"),
  devices: () => import("@/pages/portal/DevicesPage"),
  employees: () => import("@/pages/portal/EmployeesPage"),
  alerts: () => import("@/pages/portal/AlertsPage"),
  audit: () => import("@/pages/portal/AuditPage"),
  reports: () => import("@/pages/portal/ReportsPage"),
  enquiries: () => import("@/pages/portal/EnquiriesPage"),
}

function portalRoute(module: PortalModule): RouteObject {
  const lazyComponent = async () => {
    const custom = CUSTOM_PAGES[module.id]
    if (custom) {
      const { default: Page } = await custom()
      return () => (
        <RequireRole roles={module.roles}>
          <Page />
        </RequireRole>
      )
    }
    const { default: ModulePage } = await import("@/pages/portal/ModulePage")
    return () => (
      <RequireRole roles={module.roles}>
        <ModulePage module={module} />
      </RequireRole>
    )
  }

  const route = { lazy: async () => ({ Component: await lazyComponent() }) }
  return module.path === "" ? { index: true, ...route } : { path: module.path, ...route }
}

export const routes: RouteObject[] = [
  {
    errorElement: <RouteError />,
    HydrateFallback: RouteLoading,
    children: [
      {
        // Public customer website: never imports portal code or internal data.
        Component: PublicLayout,
        children: [
          { index: true, lazy: () => import("@/pages/public/HomePage").then((m) => ({ Component: m.default })) },
          { path: "products", lazy: () => import("@/pages/public/ProductsPage").then((m) => ({ Component: m.default })) },
          {
            path: "products/:slug",
            lazy: () => import("@/pages/public/ProductDetailPage").then((m) => ({ Component: m.default })),
          },
          { path: "about", lazy: () => import("@/pages/public/AboutPage").then((m) => ({ Component: m.default })) },
          { path: "contact", lazy: () => import("@/pages/public/ContactPage").then((m) => ({ Component: m.default })) },
          { path: "*", lazy: () => import("@/components/common/NotFound").then((m) => ({ Component: m.PublicNotFound })) },
        ],
      },
      {
        path: "portal/sign-in",
        lazy: () => import("@/features/auth/SignInPage").then((m) => ({ Component: m.default })),
      },
      {
        // Standalone fallback page for unpermitted/ordinary users
        path: "unauthorized",
        element: <UnauthorizedUserPage />,
      },
      {
        // Management portal: requires a staff session; each page also checks its roles.
        path: "portal",
        Component: RequireAuth,
        children: [
          {
            lazy: () => import("@/components/layout/PortalLayout").then((m) => ({ Component: m.PortalLayout })),
            children: [
              ...PORTAL_MODULES.map(portalRoute),
              // Unknown portal paths keep the sidebar and point back to the dashboard.
              { path: "*", lazy: () => import("@/pages/portal/NotFoundPage").then((m) => ({ Component: m.default })) },
            ],
          },
        ],
      },
    ],
  },
]