import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach, vi } from "vitest"

// jsdom has no matchMedia; tests override `matches` through mockSystemTheme().
let systemDark = false
const listeners = new Set<(event: MediaQueryListEvent) => void>()

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn((query: string) => ({
    get matches() {
      return query.includes("dark") && systemDark
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
})

export function mockSystemTheme(dark: boolean) {
  systemDark = dark
  listeners.forEach((listener) => listener({ matches: dark } as MediaQueryListEvent))
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  document.documentElement.className = ""
  systemDark = false
})
