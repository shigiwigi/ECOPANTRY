export type ThemePreference = "light" | "dark" | "system"
export type ResolvedTheme = "light" | "dark"

// Keep in sync with the inline script in index.html, which applies the theme before React loads.
export const THEME_STORAGE_KEY = "ecopantry-theme"

const PREFERENCES: readonly ThemePreference[] = ["light", "dark", "system"]

export function readStoredPreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY)
    return PREFERENCES.includes(value as ThemePreference) ? (value as ThemePreference) : "system"
  } catch {
    return "system"
  }
}

export function storePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the choice then lasts for this visit only.
  }
}

export function systemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "system" ? systemTheme() : preference
}

export function applyTheme(theme: ResolvedTheme): void {
  const root = document.documentElement
  root.classList.toggle("dark", theme === "dark")
  root.style.colorScheme = theme
}
