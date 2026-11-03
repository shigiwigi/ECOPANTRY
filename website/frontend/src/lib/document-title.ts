import { useEffect } from "react"

const SITE = "EcoPantry"
const PORTAL = "EcoPantry portal"

/**
 * Sets the browser tab title for the current page, so tabs, history and screen
 * readers can tell pages apart. Pass no title for the site's home page.
 */
export function useDocumentTitle(title?: string, area: "public" | "portal" = "public") {
  useEffect(() => {
    const suffix = area === "portal" ? PORTAL : SITE
    document.title = title ? `${title} | ${suffix}` : suffix
  }, [title, area])
}
