import type { SubjectKey } from "@polyroutine/contracts"
import type { DatabaseHandle } from "@polyroutine/db"
import { DuplicateEmailError } from "./errors.js"

export type NewSessionRecord = {
  readonly csrfHash: string
  readonly expiresAt: Date
  readonly familyId: string
  readonly id: string
  readonly subjectKey: string
  readonly tokenHash: string
}

export type SessionRecord = {
  readonly csrf_hash: string
  readonly expires_at: Date
  readonly family_id: string
  readonly id: string
  readonly replaced_by_session_id: string | null
  readonly revoked_at: Date | null
  readonly subject_key: SubjectKey
}

export type CredentialRecord = {
  readonly password_hash: string
  readonly subject_key: SubjectKey
}

export type CreateAccountRecord = {
  readonly adultSelfAttestedAt: Date
  readonly email: string
  readonly passwordHash: string
  readonly privacyVersion: string
  readonly session: NewSessionRecord
  readonly termsVersion: string
  readonly timezone: string
}

export type DeleteAccountRecord = {
  readonly auditId: string
  readonly imageDeletionJobId: string
  readonly subjectKey: SubjectKey
  readonly tombstoneKey: string
}

export type DeleteAccountResult = {
  readonly cancelledGoalCount: number
  readonly imageDeletionJobId: string
  readonly tombstoneSubjectKey: SubjectKey
}

export type RotateResult =
  | { readonly kind: "invalid" }
  | { readonly kind: "reused"; readonly subjectKey: SubjectKey }
  | { readonly kind: "rotated" }

export class AccountsRepository {
  constructor(private readonly database: DatabaseHandle) {}

  async createAccount(record: CreateAccountRecord): Promise<SubjectKey> {
    const client = await this.database.pool.connect()
    try {
      await client.query("begin")
      const user = await client.query<{ readonly subject_key: SubjectKey }>(
        "insert into users(subject_key, timezone) values ($1, $2) returning subject_key",
        [record.session.subjectKey, record.timezone],
      )
      const account = await client.query(
        `insert into accounts(subject_key, email_normalized, password_hash,
           adult_self_attested_at, terms_version, privacy_version)
         values ($1, $2, $3, $4, $5, $6) on conflict (email_normalized) do nothing
         returning subject_key`,
        [
          record.session.subjectKey,
          record.email,
          record.passwordHash,
          record.adultSelfAttestedAt,
          record.termsVersion,
          record.privacyVersion,
        ],
      )
      if (account.rowCount !== 1) throw new DuplicateEmailError()
      await client.query(
        `insert into sessions(id, subject_key, token_hash, csrf_hash, family_id, expires_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          record.session.id,
          record.session.subjectKey,
          record.session.tokenHash,
          record.session.csrfHash,
          record.session.familyId,
          record.session.expiresAt,
        ],
      )
      await client.query("commit")
      const subjectKey = user.rows[0]?.subject_key
      if (subjectKey === undefined) throw new TypeError("created account has no subject key")
      return subjectKey
    } catch (error) {
      await client.query("rollback")
      throw error
    } finally {
      client.release()
    }
  }

  async findCredential(email: string): Promise<CredentialRecord | null> {
    const result = await this.database.pool.query<CredentialRecord>(
      "select subject_key, password_hash from accounts where email_normalized = $1",
      [email],
    )
    return result.rows[0] ?? null
  }

  async findPasswordHash(subjectKey: SubjectKey): Promise<string | null> {
    const result = await this.database.pool.query<{ readonly password_hash: string }>(
      "select password_hash from accounts where subject_key = $1",
      [subjectKey],
    )
    return result.rows[0]?.password_hash ?? null
  }

  async resetPassword(record: {
    readonly now: Date
    readonly passwordHash: string
    readonly replacement: NewSessionRecord
    readonly subjectKey: SubjectKey
  }): Promise<void> {
    const client = await this.database.pool.connect()
    try {
      await client.query("begin")
      await client.query("update accounts set password_hash = $2 where subject_key = $1", [
        record.subjectKey,
        record.passwordHash,
      ])
      await client.query(
        "update sessions set revoked_at = coalesce(revoked_at, $2) where subject_key = $1",
        [record.subjectKey, record.now],
      )
      await client.query(
        `insert into sessions(id, subject_key, token_hash, csrf_hash, family_id, expires_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          record.replacement.id,
          record.replacement.subjectKey,
          record.replacement.tokenHash,
          record.replacement.csrfHash,
          record.replacement.familyId,
          record.replacement.expiresAt,
        ],
      )
      await client.query("commit")
    } catch (error) {
      await client.query("rollback")
      throw error
    } finally {
      client.release()
    }
  }

  async createSession(session: NewSessionRecord): Promise<void> {
    await this.database.pool.query(
      `insert into sessions(id, subject_key, token_hash, csrf_hash, family_id, expires_at)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        session.id,
        session.subjectKey,
        session.tokenHash,
        session.csrfHash,
        session.familyId,
        session.expiresAt,
      ],
    )
  }

  async findSession(tokenHash: string): Promise<SessionRecord | null> {
    const result = await this.database.pool.query<SessionRecord>(
      `select id, subject_key, csrf_hash, family_id, expires_at, revoked_at,
         replaced_by_session_id from sessions where token_hash = $1`,
      [tokenHash],
    )
    return result.rows[0] ?? null
  }

  async rotate(currentId: string, next: NewSessionRecord, now: Date): Promise<RotateResult> {
    const client = await this.database.pool.connect()
    try {
      await client.query("begin")
      const locked = await client.query<SessionRecord>(
        `select id, subject_key, csrf_hash, family_id, expires_at, revoked_at,
           replaced_by_session_id from sessions where id = $1 for update`,
        [currentId],
      )
      const current = locked.rows[0]
      if (current === undefined || current.expires_at <= now) {
        await client.query("rollback")
        return { kind: "invalid" }
      }
      if (current.revoked_at !== null) {
        if (current.replaced_by_session_id !== null) {
          await client.query(
            "update sessions set revoked_at = coalesce(revoked_at, $2) where family_id = $1",
            [current.family_id, now],
          )
          await client.query("commit")
          return { kind: "reused", subjectKey: current.subject_key }
        }
        await client.query("rollback")
        return { kind: "invalid" }
      }
      await client.query(
        `insert into sessions(id, subject_key, token_hash, csrf_hash, family_id, expires_at)
         values ($1, $2, $3, $4, $5, $6)`,
        [next.id, next.subjectKey, next.tokenHash, next.csrfHash, next.familyId, next.expiresAt],
      )
      await client.query(
        "update sessions set revoked_at = $2, replaced_by_session_id = $3 where id = $1",
        [currentId, now, next.id],
      )
      await client.query("commit")
      return { kind: "rotated" }
    } catch (error) {
      await client.query("rollback")
      throw error
    } finally {
      client.release()
    }
  }

  async revokeSession(sessionId: string, now: Date): Promise<void> {
    await this.database.pool.query(
      "update sessions set revoked_at = coalesce(revoked_at, $2) where id = $1",
      [sessionId, now],
    )
  }

  async revokeAll(subjectKey: SubjectKey, now: Date): Promise<void> {
    await this.database.pool.query(
      "update sessions set revoked_at = coalesce(revoked_at, $2) where subject_key = $1",
      [subjectKey, now],
    )
  }
}
