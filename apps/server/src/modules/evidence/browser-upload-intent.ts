import type {
  Clock,
  EvidenceBrowserUploadStore,
  EvidenceObjectKey,
  UuidFactory,
} from "@polyroutine/contracts"
import type { DatabaseHandle } from "@polyroutine/db"
import { challengeMatches } from "./challenge.js"
import { EvidenceServiceError } from "./errors.js"
import { assertOwnedOpenGoal, type EvidenceGoalRow } from "./goal.js"
import { type EvidenceContentType, EvidenceImageError } from "./image.js"

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

export type PrepareUploadInput = {
  readonly byteSize: number
  readonly challengeCode: string
  readonly contentType: EvidenceContentType
  readonly idempotencyKey: string
}

export type UploadIntentRow = {
  readonly byte_size: number
  readonly challenge_expires_at: Date
  readonly challenge_hash: string
  readonly completed_evidence_id: string | null
  readonly content_type: string
  readonly evidence_deadline_at: Date
  readonly expires_at: Date
  readonly id: string
  readonly idempotency_key: string
  readonly object_key: EvidenceObjectKey
}

type UploadIntentRepositoryOptions = {
  readonly clock: Clock
  readonly database: DatabaseHandle
  readonly objectStore: EvidenceBrowserUploadStore
  readonly uuid: UuidFactory
}

export function createUploadIntentRepository(options: UploadIntentRepositoryOptions) {
  return {
    discard: async (row: UploadIntentRow): Promise<void> => {
      try {
        await options.objectStore.delete(row.object_key)
      } catch {
        throw new EvidenceServiceError("QUARANTINE_CLEANUP_FAILED", 503)
      }
      await options.database.pool.query(
        "delete from evidence_upload_intents where id = $1 and completed_evidence_id is null",
        [row.id],
      )
    },

    find: async (
      subjectKey: string,
      goalId: string,
      uploadId: string,
    ): Promise<UploadIntentRow> => {
      const result = await options.database.pool.query<UploadIntentRow>(
        `select i.id::text, i.idempotency_key, i.object_key, i.content_type, i.byte_size, i.expires_at,
           i.completed_evidence_id::text, c.challenge_hash, c.expires_at as challenge_expires_at,
           g.evidence_deadline_at
         from evidence_upload_intents i
         join evidence_challenges c on c.id = i.challenge_id
         join goals g on g.id = i.goal_id
         where i.id = $1 and i.goal_id = $2 and i.owner_subject_key = $3`,
        [uploadId, goalId, subjectKey],
      )
      const row = result.rows[0]
      if (row === undefined) throw new EvidenceServiceError("UPLOAD_INTENT_NOT_FOUND", 404)
      return row
    },

    prepare: async (subjectKey: string, goalId: string, input: PrepareUploadInput) => {
      if (input.byteSize < 1 || input.byteSize > MAX_UPLOAD_BYTES) {
        throw new EvidenceImageError("IMAGE_LIMIT_EXCEEDED", 422)
      }
      const now = options.clock.now()
      const businessKey = `evidence:${subjectKey}:${goalId}:${input.idempotencyKey}`
      const client = await options.database.pool.connect()
      await client.query("begin")
      let row: UploadIntentRow | undefined
      try {
        const goalResult = await client.query<EvidenceGoalRow>(
          `select id::text, owner_subject_key, recipe_id, recipe_version, state, evidence_deadline_at
           from goals where id = $1 for update`,
          [goalId],
        )
        const goal = assertOwnedOpenGoal(goalResult.rows[0], subjectKey, now)
        const attempts = await client.query<{ readonly next_attempt: number }>(
          "select count(*)::integer + 1 as next_attempt from evidences where goal_id = $1",
          [goalId],
        )
        const attemptNumber = attempts.rows[0]?.next_attempt ?? 1
        if (attemptNumber > 2) {
          throw new EvidenceServiceError("EVIDENCE_ATTEMPTS_EXHAUSTED", 409)
        }
        const challengeResult = await client.query<{
          readonly challenge_hash: string
          readonly expires_at: Date
          readonly id: string
        }>(
          `select id::text, challenge_hash, expires_at from evidence_challenges
           where goal_id = $1 and owner_subject_key = $2 and attempt_number = $3
             and consumed_at is null for update`,
          [goalId, subjectKey, attemptNumber],
        )
        const challenge = challengeResult.rows[0]
        if (
          challenge === undefined ||
          !challengeMatches(challenge.challenge_hash, input.challengeCode)
        ) {
          throw new EvidenceServiceError("CHALLENGE_INVALID", 409)
        }
        if (now >= challenge.expires_at) {
          throw new EvidenceServiceError("CHALLENGE_EXPIRED", 409)
        }
        const existing = await client.query<UploadIntentRow>(
          `select i.id::text, i.idempotency_key, i.object_key, i.content_type, i.byte_size,
             i.expires_at, i.completed_evidence_id::text, c.challenge_hash,
             c.expires_at as challenge_expires_at, g.evidence_deadline_at
           from evidence_upload_intents i
           join evidence_challenges c on c.id = i.challenge_id
           join goals g on g.id = i.goal_id
           where i.business_key = $1`,
          [businessKey],
        )
        row = existing.rows[0]
        if (row === undefined) {
          const uploadId = options.uuid.create()
          const extension = input.contentType === "image/jpeg" ? "jpg" : input.contentType.slice(6)
          const objectKey =
            `quarantine-pending/${goalId}/${uploadId}.${extension}` as EvidenceObjectKey
          const expiresAt = new Date(
            Math.min(goal.evidence_deadline_at.getTime(), challenge.expires_at.getTime()),
          )
          await client.query(
            `insert into evidence_upload_intents(
               id, goal_id, owner_subject_key, challenge_id, attempt_number, business_key,
               idempotency_key, object_key, content_type, byte_size, expires_at
             ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              uploadId,
              goalId,
              subjectKey,
              challenge.id,
              attemptNumber,
              businessKey,
              input.idempotencyKey,
              objectKey,
              input.contentType,
              input.byteSize,
              expiresAt,
            ],
          )
          row = {
            byte_size: input.byteSize,
            challenge_expires_at: challenge.expires_at,
            challenge_hash: challenge.challenge_hash,
            completed_evidence_id: null,
            content_type: input.contentType,
            evidence_deadline_at: goal.evidence_deadline_at,
            expires_at: expiresAt,
            id: uploadId,
            idempotency_key: input.idempotencyKey,
            object_key: objectKey,
          }
        } else if (
          row.content_type !== input.contentType ||
          row.byte_size !== input.byteSize ||
          !challengeMatches(row.challenge_hash, input.challengeCode)
        ) {
          throw new EvidenceServiceError("IDEMPOTENCY_CONFLICT", 409)
        }
        await client.query("commit")
      } catch (error) {
        await client.query("rollback")
        throw error
      } finally {
        client.release()
      }
      if (row === undefined) throw new TypeError("upload intent was not created")
      return {
        expiresAt: row.expires_at.toISOString(),
        uploadId: row.id,
        uploadUrl: await options.objectStore.signUpload(
          { contentType: "application/octet-stream", key: row.object_key },
          row.expires_at,
        ),
      }
    },
  }
}
