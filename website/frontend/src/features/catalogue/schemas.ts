import { z } from "zod"
import type { ProductInput, StaffProduct } from "./staff"

/** Same limits as the backend (`app/services/catalogue.py`), so most mistakes are caught before sending. */
export const productFormSchema = z
  .object({
    name: z.string().trim().min(1, "Enter a product name.").max(120, "Keep the name to 120 characters or fewer."),
    slug: z
      .string()
      .trim()
      .max(80, "Keep the web address to 80 characters or fewer.")
      .regex(/^([a-z0-9]+(-[a-z0-9]+)*)?$/, "Use only lower-case letters, digits and single hyphens, for example sourdough-loaf."),
    categoryId: z.string(),
    summary: z.string().trim().max(200, "Keep the summary to 200 characters or fewer."),
    description: z.string().trim().max(5000, "Keep the description to 5000 characters or fewer."),
    price: z
      .string()
      .trim()
      .regex(/^(\d{1,8}(\.\d{1,2})?)?$/, "Enter a price such as 4.50, with at most two decimals."),
    currency: z
      .string()
      .trim()
      .regex(/^([A-Za-z]{3})?$/, "Use a three-letter currency code such as EUR or LKR."),
    isPublished: z.boolean(),
  })
  .superRefine((values, context) => {
    if (values.price && !values.currency) {
      context.addIssue({ code: "custom", path: ["currency"], message: "Add the currency for this price." })
    }
    if (values.currency && !values.price) {
      context.addIssue({ code: "custom", path: ["price"], message: "Enter a price, or clear the currency." })
    }
  })

export type ProductFormValues = z.infer<typeof productFormSchema>

export function formValuesFrom(product: StaffProduct | null, defaultCurrency: string | null): ProductFormValues {
  return {
    name: product?.name ?? "",
    slug: product?.slug ?? "",
    categoryId: product?.category_id ?? "",
    summary: product?.summary ?? "",
    description: product?.description ?? "",
    price: product?.price ?? "",
    currency: product ? (product.currency ?? "") : (defaultCurrency ?? ""),
    isPublished: product?.is_published ?? false,
  }
}

/** Request body. A blank web address is left out so the server makes one from the name (new products only). */
export function toProductInput(values: ProductFormValues, existing: StaffProduct | null): Partial<ProductInput> {
  const input: Partial<ProductInput> = {
    name: values.name,
    summary: values.summary || null,
    description: values.description || null,
    category_id: values.categoryId || null,
    price: values.price || null,
    currency: values.currency ? values.currency.toUpperCase() : null,
    is_published: values.isPublished,
  }
  if (values.slug && values.slug !== existing?.slug) input.slug = values.slug
  return input
}
