/**
 * RFID cards (`employees.view` to read, `employees.manage` to assign and revoke).
 * A card identifies someone at a station; it never signs anyone in to the portal.
 */
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query"
import { apiRequest } from "@/lib/api/client"

export interface CardHolder {
  id: string
  full_name: string
  email: string
  status: string
}

export interface RfidCard {
  id: string
  uid: string
  active: boolean
  employee: CardHolder
  assigned_at: string
  revoked_at: string | null
}

export type ScanResult = "granted" | "unknown_card" | "card_revoked" | "employee_inactive"

export interface RfidScan {
  id: number
  uid: string
  device_id: string
  result: ScanResult
  granted: boolean
  employee_name: string | null
  scanned_at: string
}

/** Staff accounts as `GET /employees` returns them (only the fields used here). */
export interface StaffAccount {
  id: string
  email: string
  full_name?: string
  name?: string
  status?: string
  is_active?: boolean
}

export const SCAN_RESULT_LABELS: Record<ScanResult, string> = {
  granted: "Granted",
  unknown_card: "Unknown card",
  card_revoked: "Card revoked",
  employee_inactive: "Account inactive",
}

export const cardsQuery = queryOptions({
  queryKey: ["rfid", "cards"] as const,
  queryFn: () => apiRequest<RfidCard[]>("/rfid/cards"),
})

export const scansQuery = queryOptions({
  queryKey: ["rfid", "scans"] as const,
  queryFn: () => apiRequest<RfidScan[]>("/rfid/scans?limit=20"),
  // New taps show up while someone is standing at the station assigning a card.
  refetchInterval: 10_000,
  refetchIntervalInBackground: false,
})

export const staffAccountsQuery = queryOptions({
  queryKey: ["employees"] as const,
  queryFn: () => apiRequest<StaffAccount[]>("/employees"),
})

export function accountName(account: StaffAccount): string {
  return account.full_name || account.name || account.email
}

export function isActiveAccount(account: StaffAccount): boolean {
  if (account.status) return account.status === "active"
  return account.is_active !== false
}

/** Same rule as the backend: 4, 7 or 10 bytes of hex, any separators. Returns "AA:BB:..." or null. */
export function normalizeUid(raw: string): string | null {
  const compact = raw.trim().replace(/[\s:-]/g, "").toUpperCase()
  if (!/^[0-9A-F]+$/.test(compact) || compact.length % 2 !== 0) return null
  if (![4, 7, 10].includes(compact.length / 2)) return null
  return compact.match(/../g)!.join(":")
}

/** UIDs tapped recently that no card has: the ones an administrator may want to assign. */
export function unassignedUids(scans: readonly RfidScan[], cards: readonly RfidCard[]): string[] {
  const active = new Set(cards.filter((card) => card.active).map((card) => card.uid))
  const seen = new Set<string>()
  const result: string[] = []
  for (const scan of scans) {
    if (scan.result !== "unknown_card" && scan.result !== "card_revoked") continue
    if (active.has(scan.uid) || seen.has(scan.uid)) continue
    seen.add(scan.uid)
    result.push(scan.uid)
  }
  return result
}

function useRefresh() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: ["rfid"] })
}

export function useAssignCard() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: ({ uid, employeeId }: { uid: string; employeeId: string }) =>
      apiRequest<RfidCard>("/rfid/cards", { method: "POST", body: { uid, employee_id: employeeId } }),
    onSuccess: refresh,
  })
}

export function useRevokeCard() {
  const refresh = useRefresh()
  return useMutation({
    mutationFn: (id: string) => apiRequest<RfidCard>(`/rfid/cards/${encodeURIComponent(id)}/revoke`, { method: "POST" }),
    onSuccess: refresh,
  })
}
