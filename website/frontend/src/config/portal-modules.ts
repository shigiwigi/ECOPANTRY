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
  Settings,
  ThermometerSun,
  Trash2,
  Truck,
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
const MANAGE: readonly Role[] = ["admin", "storekeeper"]
const OVERSIGHT: readonly Role[] = ["admin", "inspector"]

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
    id: "qr",
    path: "qr",
    label: "QR labels",
    title: "QR labels",
    summary: "Generate, print and scan batch labels. Scanning looks up a batch; it never changes stock on its own.",
    icon: QrCode,
    group: "Stock",
    roles: MANAGE,
    planned: ["Printable QR labels per batch", "Browser camera scanning to open a batch"],
    requires: "Batch API (Phase 6).",
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
    id: "environment",
    path: "environment",
    label: "Environment",
    tabLabel: "Climate",
    title: "Storage environment",
    summary: "Temperature and humidity history from the inventory station.",
    icon: ThermometerSun,
    group: "Monitoring",
    roles: ALL,
    planned: [
      "Readings with timestamps and last successful update",
      "Configurable thresholds that raise alerts",
      "Clear offline and stale states when readings stop",
    ],
    requires: "Inventory ESP32 with DHT sensor and the readings API (Phase 8).",
  },
  {
    id: "ph",
    path: "ph",
    label: "pH (experimental)",
    title: "pH measurements (experimental)",
    summary:
      "Experimental acidity records for selected samples. pH alone cannot show that food is safe or spoiled.",
    icon: FlaskConical,
    group: "Monitoring",
    roles: ALL,
    planned: [
      "Measurement records with sample, product reference range and operator",
      "Calibration notes per probe",
    ],
    requires: "Inventory ESP32 with pH probe (Phase 9).",
  },
  {
    id: "waste",
    path: "waste",
    label: "Waste",
    title: "Waste",
    summary: "Waste weight and bin fill level, recorded separately, with category and reason.",
    icon: Trash2,
    group: "Monitoring",
    roles: ALL,
    planned: [
      "Weight from the load cell and fill level from the ultrasonic sensor",
      "Waste records with category, reason, employee and time",
    ],
    requires: "Smart waste-bin ESP32 (Phase 10).",
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
    summary: "Staff records and the RFID cards used to attribute operations. RFID is identification, not strong authentication.",
    icon: IdCard,
    group: "Records",
    roles: OVERSIGHT,
    planned: ["Employee records and assigned cards", "Activity attributed by card scan"],
    requires: "RFID card API and the inventory ESP32 RFID reader (Phase 9). Staff accounts are managed through the backend API for now.",
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
    summary: "Registered ESP32 units, their credentials and when each last communicated.",
    icon: Cpu,
    group: "System",
    roles: ["admin"],
    planned: [
      "Device registration and API credential rotation",
      "Status derived from real communication, never hardcoded",
    ],
    requires: "Device API (Phase 8).",
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
 * High-frequency modules pinned to the mobile/tablet bottom bar, in order. Every
 * other module stays one tap away under "More", which opens the full navigation.
 * Keep this short (four at most) so each tab stays a comfortable touch target.
 */
export const MOBILE_TAB_IDS: readonly string[] = ["dashboard", "alerts", "inventory", "environment"]

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
