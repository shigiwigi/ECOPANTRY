import {
  BellRing,
  Boxes,
  CalendarClock,
  Camera,
  ClipboardList,
  Cpu,
  FileText,
  FlaskConical,
  IdCard,
  LayoutDashboard,
  type LucideIcon,
  Package,
  QrCode,
  ScanLine,
  Settings,
  Store,
  ThermometerSun,
  Trash2,
  Truck,
  Users,
} from "lucide-react"
import { ROLES, type Role } from "@/features/auth/roles"

/**
 * Single source of truth for the management portal: sidebar navigation,
 * routes, route-level role guards and page headings all read from here.
 *
 * Role lists drive the UI only. The FastAPI backend must enforce the same
 * permissions on every endpoint; hiding a link is not access control.
 */

export type PortalGroup = "Overview" | "Stock" | "Monitoring" | "Records" | "System"

export interface PortalModule {
  id: string
  /** Path relative to /portal. Empty string is the dashboard index. */
  path: string
  label: string
  /** Shorter label for the mobile bottom bar, where tabs are about 75px wide. Defaults to `label`. */
  tabLabel?: string
  title: string
  summary: string
  icon: LucideIcon
  group: PortalGroup
  roles: readonly Role[]
  /** What this module will do once built. Shown as planned work, never as live features. */
  planned?: string[]
  /** What must exist before the module can show data. */
  requires?: string
}

const ALL = ROLES
const MANAGE: readonly Role[] = ["admin", "shopkeeper"]
const OVERSIGHT: readonly Role[] = ["admin", "food_inspector"]

export const PORTAL_GROUPS: PortalGroup[] = ["Overview", "Stock", "Monitoring", "Records", "System"]

export const PORTAL_MODULES: PortalModule[] = [
  {
    id: "dashboard",
    path: "",
    label: "Dashboard",
    title: "Dashboard",
    summary: "What needs attention today across stock, storage conditions and devices.",
    icon: LayoutDashboard,
    group: "Overview",
    roles: ALL,
  },
  {
    id: "environment",
    path: "environment",
    label: "Environment",
    title: "Storage environment",
    summary: "Live temperature and humidity from the inventory station, with history.",
    icon: ThermometerSun,
    group: "Overview",
    roles: ALL,
  },
  {
    id: "alerts",
    path: "alerts",
    label: "Alerts",
    title: "Alerts",
    summary: "Threshold breaches, expiring batches and device problems raised by the backend.",
    icon: BellRing,
    group: "Overview",
    roles: ALL,
    planned: [
      "Open, acknowledged and resolved alerts with timestamps",
      "Alerts from temperature, humidity, expiry, stock and device rules",
      "Acknowledgement recorded against the signed-in user",
    ],
    requires: "Backend alert rules (Phase 11).",
  },
  {
    id: "inventory",
    path: "inventory",
    label: "Inventory",
    title: "Ingredient inventory",
    summary: "Raw ingredients, units, reorder levels and current stock.",
    icon: Package,
    group: "Stock",
    roles: ALL,
    planned: [
      "Ingredient records with unit and reorder level",
      "Stock-in, stock-out and adjustments, each recorded in the audit log",
      "Low-stock highlighting",
    ],
    requires: "Inventory API (Phase 5).",
  },
  {
    id: "batches",
    path: "batches",
    label: "Batches",
    title: "Batches",
    summary: "Individual ingredient batches with supplier, received date and expiry.",
    icon: Boxes,
    group: "Stock",
    roles: ALL,
    planned: [
      "Batch records linked to ingredient and supplier",
      "Remaining quantity per batch",
      "Batch history from receipt to use or disposal",
    ],
    requires: "Batch API (Phase 5).",
  },
  {
    id: "expiry",
    path: "expiry",
    label: "Expiry & FEFO",
    title: "Expiry and FEFO",
    summary: "Batches ordered by expiry so the earliest-expiring stock is used first.",
    icon: CalendarClock,
    group: "Stock",
    roles: ALL,
    planned: [
      "Near-expiry and expired batch lists",
      "First Expired, First Out recommendation per ingredient",
    ],
    requires: "Batch API with expiry dates (Phase 6).",
  },
  {
    id: "scanner",
    path: "scan",
    label: "QR scanner",
    tabLabel: "Scan",
    title: "QR scanner",
    summary: "Scan a batch label with this device's camera, or type its code, to look the batch up. Scanning never changes stock.",
    icon: ScanLine,
    group: "Stock",
    roles: ALL,
  },
  {
    id: "qr",
    path: "qr",
    label: "QR labels",
    title: "QR labels",
    summary: "Make and print QR labels for ingredient batches. A label carries only the batch code.",
    icon: QrCode,
    group: "Stock",
    roles: MANAGE,
  },
  {
    id: "suppliers",
    path: "suppliers",
    label: "Suppliers",
    title: "Suppliers",
    summary: "Supplier contacts and the batches received from each.",
    icon: Truck,
    group: "Stock",
    roles: ALL,
    planned: ["Supplier records and contacts", "Batches received per supplier"],
    requires: "Supplier API (Phase 5).",
  },
  {
    id: "ph",
    path: "ph",
    label: "pH (experimental)",
    title: "pH measurements (experimental)",
    summary: "The station's pH probe, live and over time. pH alone cannot show that food is safe or spoiled.",
    icon: FlaskConical,
    group: "Monitoring",
    roles: ALL,
  },
  {
    id: "waste",
    path: "waste",
    label: "Waste",
    title: "Waste",
    summary: "Live waste-bin weight from the load cell under the bin, with history.",
    icon: Trash2,
    group: "Monitoring",
    roles: ALL,
  },
  {
    id: "camera",
    path: "camera",
    label: "Camera",
    title: "Camera",
    summary: "Live view from the ESP32-CAM for authorised staff.",
    icon: Camera,
    group: "Monitoring",
    roles: OVERSIGHT,
    planned: ["Authorised MJPEG live view", "Connection status from the camera itself"],
    requires: "ESP32-CAM stream (Phase 11).",
  },
  {
    id: "employees",
    path: "employees",
    label: "RFID employees",
    title: "Employees and RFID cards",
    summary:
      "Who holds which RFID card, and every tap on a station. A card identifies someone at the station; it never signs anyone in to the portal.",
    icon: IdCard,
    group: "Records",
    roles: OVERSIGHT,
  },
  {
    id: "reports",
    path: "reports",
    label: "Reports",
    title: "Reports",
    summary: "Compliance-oriented reports with CSV and PDF export.",
    icon: FileText,
    group: "Records",
    roles: OVERSIGHT,
    planned: ["Stock, expiry, environment and waste reports", "CSV and PDF export"],
    requires: "Stored operational records (Phase 12).",
  },
  {
    id: "audit",
    path: "audit",
    label: "Audit log",
    title: "Audit log",
    summary: "Who changed what and when, for every stock and configuration change.",
    icon: ClipboardList,
    group: "Records",
    roles: OVERSIGHT,
    planned: ["Immutable change history with user, action and timestamp", "Filtering by user, module and date"],
    requires: "Backend audit logging (Phase 12).",
  },
  {
    id: "devices",
    path: "devices",
    label: "Devices",
    title: "Devices",
    summary: "Registered sensor stations, their tokens and when each last communicated.",
    icon: Cpu,
    group: "System",
    roles: ["admin"],
  },
  {
    id: "users",
    path: "users",
    label: "Users",
    title: "User Management",
    summary: "Authorize staff accounts, assign roles, and modify system access.",
    icon: Users,
    group: "System",
    roles: ["admin"],
  },
  {
    id: "catalogue",
    path: "catalogue",
    label: "Public catalogue",
    title: "Public catalogue",
    summary:
      "Finished products shown on the customer website. Separate from ingredient inventory; only published products are public.",
    icon: Store,
    group: "System",
    roles: ["admin"],
  },
  {
    id: "settings",
    path: "settings",
    label: "Settings",
    title: "Settings",
    summary: "Your display preferences and password.",
    icon: Settings,
    group: "System",
    roles: ALL,
  },
]

/**
 * High-frequency modules pinned to the mobile/tablet bottom bar:
 * Dashboard, Inventory, Scan, and Environment, followed by "More" (5 buttons total).
 */
export const MOBILE_TAB_IDS: readonly string[] = ["dashboard", "inventory", "scanner", "environment"]

/** The module behind the scanner shortcut. */
export const SCANNER_MODULE_ID = "scanner"

export function portalHref(module: PortalModule): string {
  return module.path ? `/portal/${module.path}` : "/portal"
}

export function modulesForRole(role: Role): PortalModule[] {
  return PORTAL_MODULES.filter((module) => module.roles.includes(role))
}

export function getModule(id: string): PortalModule {
  const module = PORTAL_MODULES.find((candidate) => candidate.id === id)
  if (!module) throw new Error(`Unknown portal module: ${id}`)
  return module
}