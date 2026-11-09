import { z } from "zod"
import { isIsoDate } from "@/features/qr/dates"

const QUANTITY = /^\d{1,9}(\.\d{1,3})?$/

function positiveQuantity(message: string) {
  return z
    .string()
    .trim()
    .regex(QUANTITY, "Enter a number with at most three decimals, for example 2.5.")
    .refine((value) => Number(value) > 0, message)
}

export const receiveFormSchema = z
  .object({
    ingredientId: z.string().min(1, "Choose an ingredient."),
    storageAreaId: z.string(),
    quantity: positiveQuantity("Enter a quantity above zero."),
    receivedOn: z.string().refine(isIsoDate, "Enter the date the stock arrived."),
    expiryOn: z.string().refine(isIsoDate, "Enter the use-by date."),
    notes: z.string().trim().max(500, "Keep the notes to 500 characters or fewer."),
  })
  .superRefine((values, context) => {
    if (isIsoDate(values.receivedOn) && isIsoDate(values.expiryOn) && values.expiryOn < values.receivedOn) {
      context.addIssue({ code: "custom", path: ["expiryOn"], message: "The use-by date can't be before the day it arrived." })
    }
  })
export type ReceiveFormValues = z.infer<typeof receiveFormSchema>

export const consumeFormSchema = z.object({
  quantity: positiveQuantity("Enter a quantity above zero."),
  reason: z.string().trim().max(200, "Keep the reason to 200 characters or fewer."),
})
export type ConsumeFormValues = z.infer<typeof consumeFormSchema>

export const adjustFormSchema = z.object({
  direction: z.enum(["decrease", "increase"]),
  quantity: positiveQuantity("Enter an amount above zero."),
  reason: z.string().trim().min(1, "Say why the stock is being adjusted.").max(200, "Keep the reason to 200 characters or fewer."),
})
export type AdjustFormValues = z.infer<typeof adjustFormSchema>

export const ingredientFormSchema = z.object({
  name: z.string().trim().min(1, "Enter an ingredient name.").max(120, "Keep the name to 120 characters or fewer."),
  unit: z.string().min(1, "Choose a unit."),
  reorderLevel: z
    .string()
    .trim()
    .regex(/^(\d{1,9}(\.\d{1,3})?)?$/, "Enter a number with at most three decimals, or leave it empty."),
})
export type IngredientFormValues = z.infer<typeof ingredientFormSchema>

export function todayIso(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}
