/**
 * Public catalogue data for the customer website.
 *
 * These calls go to `/public/*`, which needs no sign-in and returns published
 * products only. They never send the staff session cookie (`credentials:
 * "omit"`), so the public site works the same whether or not someone on this
 * browser is signed in to the portal. Keep portal-only code out of this file:
 * it is part of the public bundle.
 */
import { apiRequest } from "@/lib/api/client"

export interface PublicCategory {
  slug: string
  name: string
}

export interface PublicProduct {
  slug: string
  name: string
  summary: string | null
  category: PublicCategory | null
  /** Decimal string such as "4.50". Set exactly when `currency` is. */
  price: string | null
  currency: string | null
}

export interface PublicProductDetail extends PublicProduct {
  description: string | null
}

export interface PublicCatalogue {
  categories: PublicCategory[]
  products: PublicProduct[]
}

const PUBLIC_REQUEST = { credentials: "omit", ignoreUnauthorized: true } as const

export const publicCatalogueQuery = {
  queryKey: ["public", "catalogue"] as const,
  queryFn: () => apiRequest<PublicCatalogue>("/public/catalogue", PUBLIC_REQUEST),
}

export function publicProductQuery(slug: string) {
  return {
    queryKey: ["public", "catalogue", "product", slug] as const,
    queryFn: () => apiRequest<PublicProductDetail>(`/public/catalogue/products/${encodeURIComponent(slug)}`, PUBLIC_REQUEST),
  }
}

/** "€4.50" in the visitor's locale. Falls back to "4.50 EUR" for a currency the browser doesn't know. */
export function formatPrice(price: string, currency: string, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(Number(price))
  } catch {
    return `${price} ${currency}`
  }
}

/** Lower-case, accents removed, so "creme" finds "Crème brûlée". */
function fold(text: string): string {
  return text.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase()
}

/** Products in `categorySlug` (or all, when null) whose name, summary or category contain every search word. */
export function filterProducts(products: readonly PublicProduct[], query: string, categorySlug: string | null): PublicProduct[] {
  const words = fold(query).split(/\s+/).filter(Boolean)
  return products.filter((product) => {
    if (categorySlug && product.category?.slug !== categorySlug) return false
    if (words.length === 0) return true
    const haystack = fold([product.name, product.summary ?? "", product.category?.name ?? ""].join(" "))
    return words.every((word) => haystack.includes(word))
  })
}
