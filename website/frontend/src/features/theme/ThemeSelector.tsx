import { useId } from "react"
import { cn } from "@/lib/utils"
import { THEME_OPTIONS } from "./options"
import { useTheme } from "./theme-context"

interface ThemeSelectorProps {
  /** "full" for settings pages; "compact" is a single labelled row for menus and drawers. */
  variant?: "full" | "compact"
}

/** Theme selector as a labelled radio group, so it works with arrow keys and screen readers. */
export function ThemeSelector({ variant = "full" }: ThemeSelectorProps) {
  const { preference, resolvedTheme, setPreference } = useTheme()
  const name = useId()
  const compact = variant === "compact"

  return (
    <fieldset className="w-full">
      <legend className={cn(compact ? "text-xs font-medium tracking-wide text-muted-foreground uppercase" : "text-sm font-medium")}>
        Theme
      </legend>
      {!compact && (
        <p className="mt-1 text-sm text-muted-foreground">
          System follows your device setting
          {preference === "system" ? ` (currently ${resolvedTheme})` : ""}. Saved in this browser.
        </p>
      )}
      <div className={cn("grid grid-cols-3 gap-2", compact ? "mt-2" : "mt-3 sm:max-w-md")}>
        {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
          <label
            key={value}
            className={cn(
              "flex cursor-pointer items-center justify-center rounded-lg border bg-card text-sm transition-colors",
              compact ? "min-h-11 gap-1.5 px-2" : "flex-col gap-1.5 px-3 py-3",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
              preference === value
                ? "border-primary text-foreground ring-1 ring-primary"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <input
              type="radio"
              name={name}
              value={value}
              checked={preference === value}
              onChange={() => setPreference(value)}
              className="sr-only"
            />
            <Icon className={cn("shrink-0", compact ? "size-4" : "size-5")} aria-hidden />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
