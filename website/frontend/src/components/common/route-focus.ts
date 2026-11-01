import { useEffect, useRef } from "react"
import { useLocation } from "react-router"
import { MAIN_CONTENT_ID } from "./SkipLink"

export function focusMainContent() {
  document.getElementById(MAIN_CONTENT_ID)?.focus({ preventScroll: true })
}

/**
 * After client-side navigation, moves focus to the main content (like a full
 * page load would) so keyboard and screen-reader users start on the new page
 * instead of on the link they just used. Skips the first render.
 */
export function useFocusMainOnNavigate() {
  const { pathname } = useLocation()
  const previous = useRef(pathname)

  useEffect(() => {
    if (previous.current === pathname) return
    previous.current = pathname
    focusMainContent()
  }, [pathname])
}
