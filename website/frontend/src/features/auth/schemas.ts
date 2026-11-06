import { z } from "zod"

export const signInSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
})

export type SignInValues = z.infer<typeof signInSchema>

/** The signed-in employee as `/auth/login` and `/auth/me` describe them. */
const sessionUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  // Accepts backend codes ("storekeeper", "inspector") and frontend codes ("shopkeeper", "food_inspector", "admin")
  role: z.string(),
  permissions: z.array(z.string()).optional().default([]),
})

/**
 * Response of `POST /auth/login` and `GET /auth/me`. Validated so a malformed
 * response can't create a session in the UI.
 */
export const sessionResponseSchema = z.object({
  user: sessionUserSchema,
  csrf_token: z.string().min(1),
  expires_at: z.string().optional(),
})

export type SessionResponse = z.infer<typeof sessionResponseSchema>

export const PASSWORD_MIN_LENGTH = 12

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters.`)
      .max(128, "Use at most 128 characters."),
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ["confirmPassword"],
    message: "The new passwords don't match.",
  })

export type ChangePasswordValues = z.infer<typeof changePasswordSchema>