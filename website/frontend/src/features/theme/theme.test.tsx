import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { mockSystemTheme } from "@/test/setup"
import { THEME_STORAGE_KEY } from "./theme"
import { ThemeProvider } from "./ThemeProvider"
import { ThemeSelector } from "./ThemeSelector"

function renderSelector() {
  return render(
    <ThemeProvider>
      <ThemeSelector />
    </ThemeProvider>,
  )
}

const isDark = () => document.documentElement.classList.contains("dark")

describe("theme", () => {
  it("defaults to system and follows the OS setting live", () => {
    renderSelector()
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked()
    expect(isDark()).toBe(false)

    act(() => mockSystemTheme(true))
    expect(isDark()).toBe(true)
  })

  it("applies and persists an explicit choice", async () => {
    const user = userEvent.setup()
    renderSelector()

    await user.click(screen.getByRole("radio", { name: "Dark" }))
    expect(isDark()).toBe(true)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark")

    await user.click(screen.getByRole("radio", { name: "Light" }))
    expect(isDark()).toBe(false)
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light")
  })

  it("restores the saved preference and ignores the OS when explicit", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "light")
    mockSystemTheme(true)
    renderSelector()
    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked()
    expect(isDark()).toBe(false)
  })

  it("falls back to system for an invalid stored value", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "purple")
    renderSelector()
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked()
  })
})
