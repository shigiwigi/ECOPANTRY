import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  applyTheme,
  readStoredPreference,
  resolveTheme,
  storePreference,
  type ResolvedTheme,
  type ThemePreference,
} from "./theme"
import { ThemeContext } from "./theme-context"

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(preference))

  useEffect(() => {
    const update = () => {
      const next = resolveTheme(preference)
      setResolvedTheme(next)
      applyTheme(next)
    }
    update()
    if (preference !== "system") return

    const media = window.matchMedia("(prefers-color-scheme: dark)")
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [preference])

  const setPreference = useCallback((next: ThemePreference) => {
    storePreference(next)
    setPreferenceState(next)
  }, [])

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
