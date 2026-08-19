import type { Clock, SubjectKey, UuidFactory } from "@polyroutine/contracts"
import type { DatabaseHandle } from "@polyroutine/db"
import { z } from "zod"

export const signupInputSchema = z.object({
  adultSelfAttested: z.literal(true),
  email: z.email().trim().toLowerCase(),
  password: z.string().min(12).max(128),
  privacyVersion: z.string().trim().min(1).max(50),
  termsVersion: z.string().trim().min(1).max(50),
  timezone: z.string().trim().min(1).max(100),
})
export type SignupInput = Readonly<z.infer<typeof signupInputSchema>>

export const loginInputSchema = z.object({
  email: z.email().trim().toLowerCase(),
  password: z.string().min(1).max(128),
})
export type LoginInput = Readonly<z.infer<typeof loginInputSchema>>

export const passwordResetInputSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(12).max(128),
})
export type PasswordResetInput = Readonly<z.infer<typeof passwordResetInputSchema>>

export type SessionCredential = {
  readonly csrfToken: string
  readonly expiresAt: string
  readonly token: string
}

export type ActorContext = {
  readonly sessionFamilyId: string
  readonly sessionId: string
  readonly subjectKey: SubjectKey
}

export type AccountAuditEvent =
  | { readonly kind: "account_signup"; readonly subjectKey: SubjectKey }
  | { readonly kind: "login_rejected"; readonly reason: "credentials" | "rate_limited" }
  | { readonly kind: "password_reset"; readonly subjectKey: SubjectKey }
  | { readonly kind: "session_reuse_detected"; readonly subjectKey: SubjectKey }
  | {
      readonly cancelledGoalCount: number
      readonly imageDeletionJobId: string
      readonly kind: "account_deleted"
      readonly tombstoneSubjectKey: SubjectKey
    }

export interface AccountAuditSink {
  write(event: AccountAuditEvent): void
}

export type AccountsDependencies = {
  readonly audit: AccountAuditSink
  readonly clock: Clock
  readonly database: DatabaseHandle
  readonly expectedOrigin: string
  readonly sessionSecret: string
  readonly uuid: UuidFactory
}

export type AuthFailure =
  | { readonly kind: "csrf_rejected" }
  | { readonly kind: "invalid_session" }
  | { readonly kind: "session_reused" }

export type AuthResult =
  | { readonly kind: "authenticated"; readonly actor: ActorContext }
  | AuthFailure
