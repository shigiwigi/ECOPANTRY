/**
 * Typed fetch wrapper for the EcoPantry FastAPI backend (`/api/v1`).
 *
 * The backend owns authentication and authorisation. Requests send cookies
 * (`credentials: "include"`) so a server-issued session can be used once
 * Milestone 3 implements it; no tokens are stored in browser storage.
 */

const DEFAULT_BASE_URL = "/api/v1"

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "")

export type ApiErrorKind = "network" | "http" | "parse"

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | null
  readonly detail: unknown

  constructor(kind: ApiErrorKind, message: string, status: number | null = null, detail?: unknown) {
    super(message)
    this.name = "ApiError"
    this.kind = kind
    this.status = status
    this.detail = detail
  }

  get isUnreachable() {
    return this.kind === "network"
  }
}

const NO_BACKEND_STATUSES = new Set([404, 405, 502, 503, 504])

type JsonBody =Record<string, unknown> | unknown[]

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  body?: JsonBody
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const { body, headers, ...init } = options

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      credentials: "include",
      ...init,
      headers: {
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (cause) {
    throw new ApiError("network", "Can't reach the EcoPantry server.", null, cause)
  }

  const isJson = response.headers.get("content-type")?.includes("application/json")
  let payload: unknown = null
  if (response.status !== 204 && isJson) {
    try {
      payload = await response.json()
    } catch (cause) {
      throw new ApiError("parse", "The server sent an unreadable response.", response.status, cause)
    }
  }

  // FastAPI always answers errors with JSON. A bare 404/405 or a gateway error
  // comes from the dev server or a proxy, which means no backend answered.
  if (!isJson && NO_BACKEND_STATUSES.has(response.status)) {
    throw new ApiError("network", "Can't reach the EcoPantry server.", response.status)
  }
  if (!response.ok) {
    throw new ApiError("http", errorMessage(payload, response.status), response.status, payload)
  }
  // A dev-server fallback can answer with HTML; treat that as "no backend" rather than data.
  if (response.status !== 204 && !isJson) {
    throw new ApiError("network", "Can't reach the EcoPantry server.", response.status)
  }
  return payload as T
}

function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && "detail" in payload) {
    const { detail } = payload as { detail: unknown }
    if (typeof detail === "string") return detail
  }
  if (status === 401) return "Your session has ended. Sign in again."
  if (status === 403) return "You don't have permission to do that."
  if (status === 404) return "Not found."
  if (status >= 500) return "The server had a problem. Try again shortly."
  return `Request failed (${status}).`
}
