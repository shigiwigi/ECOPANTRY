import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

// Read from disk: Vitest is configured with `css: false`, which empties CSS imports.
const css = readFileSync(join(import.meta.dirname, "globals.css"), "utf8")

function readTokens(selector: ":root" | ".dark"): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  const block = css.slice(start, css.indexOf("}", start))
  const tokens: Record<string, string> = {}
  for (const [, name, value] of block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)) {
    tokens[name] = value
  }
  return tokens
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// [foreground token, background token, minimum ratio]
// 4.5 = WCAG AA body text, 3 = non-text UI (focus rings, input borders).
const PAIRS: [string, string, number][] = [
  ["foreground", "background", 4.5],
  ["foreground", "card", 4.5],
  ["muted-foreground", "background", 4.5],
  ["muted-foreground", "card", 4.5],
  ["muted-foreground", "muted", 4.5],
  ["primary", "background", 4.5],
  ["primary-foreground", "primary", 4.5],
  ["secondary-foreground", "secondary", 4.5],
  ["accent-foreground", "accent", 4.5],
  ["destructive", "background", 4.5],
  ["destructive-foreground", "destructive", 4.5],
  ["success", "background", 4.5],
  ["success-foreground", "success", 4.5],
  ["warning", "background", 4.5],
  ["warning-foreground", "warning", 4.5],
  ["info", "background", 4.5],
  ["info-foreground", "info", 4.5],
  ["gold-foreground", "gold", 4.5],
  ["popover-foreground", "popover", 4.5],
  ["sidebar-foreground", "sidebar", 4.5],
  ["sidebar-muted-foreground", "sidebar", 4.5],
  ["sidebar-accent-foreground", "sidebar-accent", 4.5],
  ["sidebar-primary-foreground", "sidebar-primary", 4.5],
  ["ring", "background", 3],
  ["ring", "card", 3],
  ["input", "background", 3],
  ["input", "card", 3],
  ["sidebar-ring", "sidebar", 3],
  ["sidebar-primary", "sidebar", 3],
  // Printed labels and QR codes: well above AA, because scanners and cheap printers need it.
  ["label-ink", "label-paper", 15],
]

describe.each([":root", ".dark"] as const)("%s theme tokens", (selector) => {
  const tokens = readTokens(selector)

  it.each(PAIRS)("%s on %s meets %d:1", (fg, bg, min) => {
    expect(tokens[fg], `missing --${fg}`).toBeDefined()
    expect(tokens[bg], `missing --${bg}`).toBeDefined()
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(min)
  })
})
