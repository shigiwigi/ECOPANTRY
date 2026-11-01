import { cn } from "@/lib/utils"
import { THEME_OPTIONS } from "./options"
import { useTheme } from "./theme-context"

/** Full theme selector for settings pages: a labelled radio group. */
export function ThemeSelector() {
  const { preference, resolvedTheme, setPreference } = useTheme()

  return (
    <fieldset>
      <legend className="text-sm font-medium">Theme</legend>
      <p className="mt-1 text-sm text-muted-foreground">
        System follows your device setting
        {preference === "system" ? ` (currently ${resolvedTheme})` : ""}. Saved in this browser.
      </p>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:max-w-md">
        {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
          <label
            key={value}
            className={cn(
              "flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border bg-card px-3 py-3 text-sm transition-colors",
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring",
              preference === value
                ? "border-primary text-foreground ring-1 ring-primary"
                : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <input
              type="radio"
              name="theme"
              value={value}
              checked={preference === value}
              onChange={() => setPreference(value)}
              className="sr-only"
            />
            <Icon className="size-5" aria-hidden />
            {label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
