import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react"
import type { ThemePreference } from "./theme"

export const THEME_OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
]
