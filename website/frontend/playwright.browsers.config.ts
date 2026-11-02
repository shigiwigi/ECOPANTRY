import { defineConfig, devices } from "@playwright/test"
import baseConfig from "./playwright.config"

/**
 * The QR and layout suites in browsers other than desktop Chromium.
 *
 *   npx playwright install firefox webkit   # once
 *   npm run test:e2e:browsers
 *
 * - firefox: Playwright's Firefox build, with Firefox's own fake camera, so the
 *   scanner's start/stop and camera clean-up run against a real Firefox stream.
 * - android-chrome: Chromium with a Pixel 7's screen, touch and user agent. An
 *   emulation, not a phone: it checks layout and touch, not Android's camera stack.
 * - webkit / ios-safari: Playwright's WebKit build (closest to Safari available
 *   off a Mac; not Safari itself). Needs the host libraries Playwright lists;
 *   it won't start on hosts without them (Fedora, for example).
 *
 * Select one with --project. Physical devices and real Safari still need manual checks
 * (docs/QR_LABELS.md has the checklist).
 */
const FIREFOX_FAKE_CAMERA = {
  "media.navigator.streams.fake": true,
  "media.navigator.permission.disabled": true,
}

export default defineConfig({
  ...baseConfig,
  testMatch: ["qr.spec.ts", "smoke.spec.ts"],
  outputDir: "./e2e/.results-browsers",
  projects: [
    {
      name: "firefox",
      use: { ...devices["Desktop Firefox"], launchOptions: { firefoxUserPrefs: FIREFOX_FAKE_CAMERA } },
    },
    { name: "android-chrome", use: { ...devices["Pixel 7"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "ios-safari", use: { ...devices["iPhone 13"] } },
  ],
})
