import { z } from "zod"
import { ROLES } from "./roles"

export const signInSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
})

export type SignInValues = z.infer<typeof signInSchema>

/** Expected shape of `POST /auth/login`; validated so a malformed response can't create a session. */
export const staffUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
})
