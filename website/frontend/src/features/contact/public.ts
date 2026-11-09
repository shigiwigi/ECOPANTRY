/**
 * The public contact form. Part of the public bundle: no portal imports.
 *
 * Posts to `/public/enquiries` without the staff session cookie
 * (`credentials: "omit"`), so it behaves the same whether or not someone on
 * this browser is signed in to the portal.
 */
import { z } from "zod"
import { apiRequest } from "@/lib/api/client"

/** Same limits as the backend (`app/models/enquiries.py`). */
export const contactFormSchema = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120, "Keep your name to 120 characters or fewer."),
  email: z
    .string()
    .trim()
    .min(1, "Enter your email address.")
    .max(254, "That email address is too long.")
    .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Enter a valid email address, for example name@example.com."),
  message: z.string().trim().min(1, "Write a message.").max(5000, "Keep your message to 5000 characters or fewer."),
  // Honeypot: hidden from people. Only a bot fills it in.
  website: z.string().max(500),
})

export type ContactFormValues = z.infer<typeof contactFormSchema>

export function sendEnquiry(values: ContactFormValues) {
  return apiRequest<{ accepted: boolean }>("/public/enquiries", {
    method: "POST",
    body: { ...values },
    credentials: "omit",
    ignoreUnauthorized: true,
  })
}
