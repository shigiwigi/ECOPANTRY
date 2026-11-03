/**
 * Public bakery details shown on the customer website.
 *
 * TODO(owners): fill in the real details before public release. Fields left
 * as null are hidden on the site rather than replaced with invented values.
 */
export const siteConfig = {
  name: "EcoPantry",
  tagline: "Baked fresh. Stored with care.",
  contact: {
    email: null as string | null,
    phone: null as string | null,
    address: null as string | null,
  },
  openingHours: null as { days: string; hours: string }[] | null,
}

/** True once the owners have published at least one way to reach the bakery. */
export function hasContactDetails(): boolean {
  const { email, phone, address } = siteConfig.contact
  return Boolean(email || phone || address || siteConfig.openingHours)
}

export const PUBLIC_NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/products", label: "Products", end: false },
  { to: "/about", label: "About", end: false },
  { to: "/contact", label: "Contact", end: false },
] as const
