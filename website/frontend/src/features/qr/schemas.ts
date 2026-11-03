import { z } from "zod"
import { READ_PROBLEMS, readTypedLabel } from "./batch-label"
import { isIsoDate } from "./dates"

export const MAX_NAME_LENGTH = 40
export const MAX_COPIES = 21
/** One print job; about five A4 sheets. */
export const MAX_LABELS = 105

/** The label form. Every field stays a string, as typed; `toLabel` converts on submit. */
export const labelFormSchema = z.object({
  ingredientName: z
    .string()
    .trim()
    .min(1, "Enter the ingredient name.")
    .max(MAX_NAME_LENGTH, `Keep the name to ${MAX_NAME_LENGTH} characters so it fits on the label.`),
  code: z.string().superRefine((value, context) => {
    const result = readTypedLabel(value)
    if (!result.ok) context.addIssue({ code: "custom", message: READ_PROBLEMS[result.reason] })
  }),
  expiresOn: z.string().refine((value) => value === "" || isIsoDate(value), "Enter a valid date, or leave it empty."),
  copies: z
    .string()
    .regex(/^\d+$/, "Enter a whole number.")
    .refine((value) => Number(value) >= 1 && Number(value) <= MAX_COPIES, `Between 1 and ${MAX_COPIES}.`),
})

export type LabelFormValues = z.infer<typeof labelFormSchema>
