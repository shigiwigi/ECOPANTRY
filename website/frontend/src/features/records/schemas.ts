import { z } from "zod"
import { WASTE_CATEGORIES, type PhInput, type WasteInput } from "./api"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const batchId = z.string().trim().refine((value) => value === "" || UUID.test(value), "Paste a batch ID, or leave this empty.")

/** Same limits as the backend (`app/services/records.py`). */
export const wasteFormSchema = z
  .object({
    category: z.enum(WASTE_CATEGORIES, { error: "Choose a category." }),
    reason: z.string().trim().max(500, "Keep the reason to 500 characters or fewer."),
    weight: z
      .string()
      .trim()
      .regex(/^(\d{1,5}(\.\d{1,3})?)?$/, "Enter a weight in kg such as 1.25, with at most three decimals."),
    batchId,
  })
  .superRefine((values, context) => {
    if (values.category === "other" && !values.reason) {
      context.addIssue({ code: "custom", path: ["reason"], message: "Say what happened when the category is Other." })
    }
  })

export type WasteFormValues = z.infer<typeof wasteFormSchema>

export const EMPTY_WASTE_FORM = { category: "" as unknown as WasteFormValues["category"], reason: "", weight: "", batchId: "" }

export function toWasteInput(values: WasteFormValues): WasteInput {
  return {
    category: values.category,
    reason: values.reason || null,
    weight_kg: values.weight || null,
    batch_id: values.batchId || null,
  }
}

const phNumber = (what: string) => z.string().trim().regex(/^(\d{1,2}(\.\d{1,2})?)?$/, `Enter ${what} as a number such as 4.5.`)

export const phFormSchema = z
  .object({
    sample: z.string().trim().min(1, "Describe the sample.").max(200, "Keep the description to 200 characters or fewer."),
    value: phNumber("the pH").min(1, "Enter the measured pH."),
    referenceMin: phNumber("the minimum"),
    referenceMax: phNumber("the maximum"),
    calibration: z.string().trim().max(500, "Keep the note to 500 characters or fewer."),
    batchId,
  })
  .superRefine((values, context) => {
    const inRange = (text: string) => text === "" || (Number(text) >= 0 && Number(text) <= 14)
    if (!inRange(values.value)) context.addIssue({ code: "custom", path: ["value"], message: "pH is between 0 and 14." })
    if (!inRange(values.referenceMin)) context.addIssue({ code: "custom", path: ["referenceMin"], message: "pH is between 0 and 14." })
    if (!inRange(values.referenceMax)) context.addIssue({ code: "custom", path: ["referenceMax"], message: "pH is between 0 and 14." })
    if (Boolean(values.referenceMin) !== Boolean(values.referenceMax)) {
      const path = values.referenceMin ? "referenceMax" : "referenceMin"
      context.addIssue({ code: "custom", path: [path], message: "Give both ends of the reference range, or neither." })
    } else if (values.referenceMin && Number(values.referenceMin) > Number(values.referenceMax)) {
      context.addIssue({ code: "custom", path: ["referenceMin"], message: "The minimum can't be above the maximum." })
    }
  })

export type PhFormValues = z.infer<typeof phFormSchema>

export const EMPTY_PH_FORM: PhFormValues = {
  sample: "",
  value: "",
  referenceMin: "",
  referenceMax: "",
  calibration: "",
  batchId: "",
}

export function toPhInput(values: PhFormValues): PhInput {
  return {
    sample_description: values.sample,
    ph_value: values.value,
    reference_min: values.referenceMin || null,
    reference_max: values.referenceMax || null,
    calibration_note: values.calibration || null,
    batch_id: values.batchId || null,
  }
}
