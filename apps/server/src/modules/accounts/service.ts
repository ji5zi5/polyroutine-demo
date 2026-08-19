import type { SubjectKey } from "@polyroutine/contracts"
import { Argon2idPasswordHasher, OpaqueSecretCodec } from "./crypto.js"
import { AccountDeletionRepository } from "./deletion-repository.js"
import { DuplicateEmailError } from "./errors.js"
import { LoginRateLimitRepository } from "./login-rate-limit.js"
import { AccountsRepository, type NewSessionRecord } from "./repository.js"
import type {
  AccountsDependencies,
  ActorContext,
  AuthResult,
  LoginInput,
  PasswordResetInput,
  SessionCredential,
  SignupInput,
} from "./types.js"

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1_000

export type SignupResult =
  | {
      readonly ageAssurance: "self_attestation_not_identity_or_age_verification"
      readonly kind: "created"
      readonly minimumAge: 18
      readonly notice: string
      readonly session: SessionCredential
      readonly subjectKey: SubjectKey
    }
  | { readonly kind: "email_conflict" }

export type LoginResult =
  | { readonly kind: "authenticated"; readonly session: SessionCredential }
  | { readonly kind: "credentials_rejected" }
  | { readonly kind: "rate_limited" }

export type PasswordResetResult =
  | { readonly kind: "current_password_rejected" }
  | { readonly kind: "reset"; readonly session: SessionCredential }

export type RotateSessionResult =
  | { readonly kind: "rotated"; readonly session: SessionCredential }
  | Exclude<AuthResult, { readonly kind: "authenticated" }>

export class AccountsService {
  private readonly deletion: AccountDeletionRepository
  private readonly hasher = new Argon2idPasswordHasher()
  private readonly rateLimits: LoginRateLimitRepository
  private readonly repository: AccountsRepository
  private readonly secrets: OpaqueSecretCodec

  constructor(private readonly dependencies: AccountsDependencies) {
    this.repository = new AccountsRepository(dependencies.database)
    this.deletion = new AccountDeletionRepository(dependencies.database)
    this.rateLimits = new LoginRateLimitRepository(dependencies.database)
    this.secrets = new OpaqueSecretCodec(dependencies.sessionSecret)
  }

  async signup(input: SignupInput): Promise<SignupResult> {
    const now = this.dependencies.clock.now()
    const subjectKey = `subject:${this.dependencies.uuid.create()}`
    const session = this.issueSession(subjectKey, this.dependencies.uuid.create(), now)
    try {
      const createdSubjectKey = await this.repository.createAccount({
        adultSelfAttestedAt: now,
        email: input.email,
        passwordHash: await this.hasher.hash(input.password),
        privacyVersion: input.privacyVersion,
        session: session.record,
        termsVersion: input.termsVersion,
        timezone: input.timezone,
      })
      this.dependencies.audit.write({ kind: "account_signup", subjectKey: createdSubjectKey })
      return {
        ageAssurance: "self_attestation_not_identity_or_age_verification",
        kind: "created",
        minimumAge: 18,
        notice:
          "Adults 18+ only. This is self-attestation, not identity verification or age verification.",
        session: session.credential,
        subjectKey: createdSubjectKey,
      }
    } catch (error) {
      if (error instanceof DuplicateEmailError) return { kind: "email_conflict" }
      throw error
    }
  }

  async login(input: LoginInput, clientAddress: string): Promise<LoginResult> {
    const now = this.dependencies.clock.now()
    const rateKeyHash = this.secrets.hash(`login:${clientAddress}:${input.email}`)
    if (await this.rateLimits.isBlocked(rateKeyHash, now)) {
      this.dependencies.audit.write({ kind: "login_rejected", reason: "rate_limited" })
      return { kind: "rate_limited" }
    }
    const credential = await this.repository.findCredential(input.email)
    const passwordMatches =
      credential === null
        ? await this.consumeMissingCredentialWork(input.password)
        : await this.hasher.verify(credential.password_hash, input.password)
    if (credential === null || !passwordMatches) {
      await this.rateLimits.recordFailure(rateKeyHash, now)
      this.dependencies.audit.write({ kind: "login_rejected", reason: "credentials" })
      return { kind: "credentials_rejected" }
    }
    await this.rateLimits.clear(rateKeyHash)
    const session = this.issueSession(credential.subject_key, this.dependencies.uuid.create(), now)
    await this.repository.createSession(session.record)
    return { kind: "authenticated", session: session.credential }
  }

  async authenticate(token: string, csrfToken: string): Promise<AuthResult> {
    const session = await this.repository.findSession(this.secrets.hash(token))
    if (session === null) return { kind: "invalid_session" }
    if (!this.secrets.matches(csrfToken, session.csrf_hash)) return { kind: "csrf_rejected" }
    if (session.revoked_at !== null) {
      if (session.replaced_by_session_id !== null) {
        await this.repository.revokeAll(session.subject_key, this.dependencies.clock.now())
        this.dependencies.audit.write({
          kind: "session_reuse_detected",
          subjectKey: session.subject_key,
        })
        return { kind: "session_reused" }
      }
      return { kind: "invalid_session" }
    }
    if (session.expires_at <= this.dependencies.clock.now()) return { kind: "invalid_session" }
    return {
      actor: {
        sessionFamilyId: session.family_id,
        sessionId: session.id,
        subjectKey: session.subject_key,
      },
      kind: "authenticated",
    }
  }

  async resetPassword(
    actor: ActorContext,
    input: PasswordResetInput,
  ): Promise<PasswordResetResult> {
    const currentHash = await this.repository.findPasswordHash(actor.subjectKey)
    if (currentHash === null || !(await this.hasher.verify(currentHash, input.currentPassword))) {
      return { kind: "current_password_rejected" }
    }
    const now = this.dependencies.clock.now()
    const replacement = this.issueSession(actor.subjectKey, this.dependencies.uuid.create(), now)
    await this.repository.resetPassword({
      now,
      passwordHash: await this.hasher.hash(input.newPassword),
      replacement: replacement.record,
      subjectKey: actor.subjectKey,
    })
    this.dependencies.audit.write({ kind: "password_reset", subjectKey: actor.subjectKey })
    return { kind: "reset", session: replacement.credential }
  }

  async rotate(token: string, csrfToken: string): Promise<RotateSessionResult> {
    const authentication = await this.authenticate(token, csrfToken)
    if (authentication.kind !== "authenticated") return authentication
    const now = this.dependencies.clock.now()
    const next = this.issueSession(
      authentication.actor.subjectKey,
      authentication.actor.sessionFamilyId,
      now,
    )
    const result = await this.repository.rotate(authentication.actor.sessionId, next.record, now)
    switch (result.kind) {
      case "invalid":
        return { kind: "invalid_session" }
      case "reused":
        this.dependencies.audit.write({
          kind: "session_reuse_detected",
          subjectKey: result.subjectKey,
        })
        return { kind: "session_reused" }
      case "rotated":
        return { kind: "rotated", session: next.credential }
    }
  }

  async logout(actor: ActorContext): Promise<void> {
    await this.repository.revokeSession(actor.sessionId, this.dependencies.clock.now())
  }

  async logoutAll(actor: ActorContext): Promise<void> {
    await this.repository.revokeAll(actor.subjectKey, this.dependencies.clock.now())
  }

  async deleteAccount(actor: ActorContext): Promise<{
    readonly cancelledGoalCount: number
    readonly imageDeletionJobId: string
    readonly tombstoneSubjectKey: SubjectKey
  }> {
    const result = await this.deletion.deleteAccount({
      auditId: this.dependencies.uuid.create(),
      imageDeletionJobId: this.dependencies.uuid.create(),
      subjectKey: actor.subjectKey,
      tombstoneKey: `deleted:${this.dependencies.uuid.create()}`,
    })
    this.dependencies.audit.write({
      cancelledGoalCount: result.cancelledGoalCount,
      imageDeletionJobId: result.imageDeletionJobId,
      kind: "account_deleted",
      tombstoneSubjectKey: result.tombstoneSubjectKey,
    })
    return result
  }

  private async consumeMissingCredentialWork(password: string): Promise<false> {
    await this.hasher.hash(password)
    return false
  }

  private issueSession(
    subjectKey: string,
    familyId: string,
    now: Date,
  ): {
    readonly credential: SessionCredential
    readonly record: NewSessionRecord
  } {
    const token = this.secrets.issue()
    const csrf = this.secrets.issue()
    const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS)
    return {
      credential: { csrfToken: csrf.value, expiresAt: expiresAt.toISOString(), token: token.value },
      record: {
        csrfHash: csrf.hash,
        expiresAt,
        familyId,
        id: this.dependencies.uuid.create(),
        subjectKey,
        tokenHash: token.hash,
      },
    }
  }
}
