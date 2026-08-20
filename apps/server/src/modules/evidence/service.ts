import { createHash, timingSafeEqual } from "node:crypto"
import type {
  Clock,
  EvidenceObjectKey,
  EvidenceObjectStore,
  UuidFactory,
} from "@polyroutine/contracts"
import { evidenceRecipeV1 } from "@polyroutine/contracts"
import type { DatabaseHandle } from "@polyroutine/db"
import type { EvidenceImage } from "./image.js"

const CHALLENGE_PREFIX = "PR-"

type EvidenceServiceOptions = {
  readonly clock: Clock
  readonly database: DatabaseHandle
  readonly objectStore: EvidenceObjectStore
  readonly uuid: UuidFactory
}

type GoalRow = {
  readonly evidence_deadline_at: Date
  readonly id: string
  readonly owner_subject_key: string
  readonly recipe_id: string
  readonly recipe_version: number
  readonly state: string
}

type ChallengeRow = {
  readonly challenge_hash: string
  readonly consumed_at: Date | null
  readonly expires_at: Date
  readonly id: string
}

export class EvidenceServiceError extends Error {
  override readonly name = "EvidenceServiceError"

  constructor(
    readonly code:
      | "CHALLENGE_EXPIRED"
      | "CHALLENGE_INVALID"
      | "CHALLENGE_REQUIRED"
      | "EVIDENCE_ATTEMPTS_EXHAUSTED"
      | "EVIDENCE_DEADLINE"
      | "EVIDENCE_NOT_OPEN"
      | "GOAL_NOT_FOUND"
      | "IDEMPOTENCY_CONFLICT"
      | "QUARANTINE_CLEANUP_FAILED"
      | "QUARANTINE_UNAVAILABLE",
    readonly statusCode: 404 | 409 | 503,
  ) {
    super(code)
  }
}

function challengeHash(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex")
}

function challengeMatches(expectedHash: string, code: string): boolean {
  const actual = Buffer.from(challengeHash(code), "hex")
  const expected = Buffer.from(expectedHash, "hex")
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function createChallengeCode(uuid: string): string {
  return `${CHALLENGE_PREFIX}${uuid.replaceAll("-", "").slice(0, 8).toUpperCase()}`
}

function assertOwnedOpenGoal(goal: GoalRow | undefined, subjectKey: string, now: Date): GoalRow {
  if (goal === undefined || goal.owner_subject_key !== subjectKey) {
    throw new EvidenceServiceError("GOAL_NOT_FOUND", 404)
  }
  if (
    goal.state !== "evidence_open" ||
    goal.recipe_id !== evidenceRecipeV1.id ||
    goal.recipe_version !== evidenceRecipeV1.version
  ) {
    throw new EvidenceServiceError("EVIDENCE_NOT_OPEN", 409)
  }
  if (now >= goal.evidence_deadline_at) {
    throw new EvidenceServiceError("EVIDENCE_DEADLINE", 409)
  }
  return goal
}

async function deleteFailedObject(
  objectStore: EvidenceObjectStore,
  objectKey: EvidenceObjectKey,
): Promise<void> {
  try {
    await objectStore.delete(objectKey)
  } catch {
    throw new EvidenceServiceError("QUARANTINE_CLEANUP_FAILED", 503)
  }
}

export function createEvidenceService(options: EvidenceServiceOptions) {
  return {
    quarantineRejected: async (subjectKey: string, goalId: string, reason: string) => {
      const now = options.clock.now()
      const goal = await options.database.pool.query(
        "select 1 from goals where id = $1 and owner_subject_key = $2",
        [goalId, subjectKey],
      )
      if (goal.rowCount !== 1) return
      await options.database.pool.query(
        `insert into moderation_cases(id, goal_id, state, reason, created_at, review_due_at)
         values ($1, $2, 'quarantined', $3, $4, $5)`,
        [
          options.uuid.create(),
          goalId,
          `unsafe_upload:${reason}`,
          now,
          new Date(now.getTime() + 24 * 60 * 60 * 1_000),
        ],
      )
    },

    challenge: async (subjectKey: string, goalId: string) => {
      const now = options.clock.now()
      const expiresAt = new Date(
        now.getTime() + evidenceRecipeV1.capture.challengeExpiresInSeconds * 1_000,
      )
      const challengeId = options.uuid.create()
      const code = createChallengeCode(options.uuid.create())
      const client = await options.database.pool.connect()
      await client.query("begin")
      try {
        const goalResult = await client.query<GoalRow>(
          `select id::text, owner_subject_key, recipe_id, recipe_version, state, evidence_deadline_at
           from goals where id = $1 for update`,
          [goalId],
        )
        assertOwnedOpenGoal(goalResult.rows[0], subjectKey, now)
        const attempts = await client.query<{ readonly next_attempt: number }>(
          "select count(*)::integer + 1 as next_attempt from evidences where goal_id = $1",
          [goalId],
        )
        const attemptNumber = attempts.rows[0]?.next_attempt ?? 1
        if (attemptNumber > 2) {
          throw new EvidenceServiceError("EVIDENCE_ATTEMPTS_EXHAUSTED", 409)
        }
        await client.query(
          `insert into evidence_challenges(
             id, goal_id, owner_subject_key, attempt_number, challenge_hash, expires_at, signal_kind
           ) values ($1, $2, $3, $4, $5, $6, 'replay_reduction_only')
           on conflict (goal_id, attempt_number) do update set
             id = excluded.id,
             owner_subject_key = excluded.owner_subject_key,
             challenge_hash = excluded.challenge_hash,
             expires_at = excluded.expires_at,
             consumed_at = null,
             signal_kind = excluded.signal_kind`,
          [challengeId, goalId, subjectKey, attemptNumber, challengeHash(code), expiresAt],
        )
        await client.query("commit")
        return {
          challengeId,
          claim: evidenceRecipeV1.capture.claim,
          code,
          expiresAt: expiresAt.toISOString(),
          instructions: evidenceRecipeV1.instructions,
        }
      } catch (error) {
        await client.query("rollback")
        throw error
      } finally {
        client.release()
      }
    },

    submit: async (
      subjectKey: string,
      goalId: string,
      challengeCode: string | undefined,
      image: EvidenceImage,
      idempotencyKey?: string,
    ) => {
      const now = options.clock.now()
      const evidenceId = options.uuid.create()
      const receiptBusinessKey =
        idempotencyKey === undefined
          ? `evidence:${evidenceId}:receipt`
          : `evidence:${subjectKey}:${goalId}:${idempotencyKey}`
      const objectKey = `quarantine/${goalId}/${evidenceId}.${image.extension}` as EvidenceObjectKey
      const client = await options.database.pool.connect()
      let objectPut = false
      await client.query("begin")
      try {
        const goalResult = await client.query<GoalRow>(
          `select id::text, owner_subject_key, recipe_id, recipe_version, state, evidence_deadline_at
           from goals where id = $1 for update`,
          [goalId],
        )
        const goal = goalResult.rows[0]
        if (goal === undefined || goal.owner_subject_key !== subjectKey) {
          throw new EvidenceServiceError("GOAL_NOT_FOUND", 404)
        }
        const replay = await client.query<{
          readonly id: string
          readonly sha256: string
          readonly state: string
        }>(
          `select e.id::text, e.state, u.sha256
           from evidences e join evidence_uploads u on u.evidence_id = e.id
           where e.business_key = $1`,
          [receiptBusinessKey],
        )
        const priorReceipt = replay.rows[0]
        if (priorReceipt !== undefined) {
          if (priorReceipt.sha256 !== image.sha256) {
            throw new EvidenceServiceError("IDEMPOTENCY_CONFLICT", 409)
          }
          await client.query("commit")
          return { receiptId: priorReceipt.id, state: priorReceipt.state as "pending" }
        }
        assertOwnedOpenGoal(goal, subjectKey, now)
        const attempts = await client.query<{ readonly next_attempt: number }>(
          "select count(*)::integer + 1 as next_attempt from evidences where goal_id = $1",
          [goalId],
        )
        const attemptNumber = attempts.rows[0]?.next_attempt ?? 1
        if (attemptNumber > 2) {
          throw new EvidenceServiceError("EVIDENCE_ATTEMPTS_EXHAUSTED", 409)
        }
        if (challengeCode === undefined) {
          throw new EvidenceServiceError("CHALLENGE_REQUIRED", 409)
        }
        const challengeResult = await client.query<ChallengeRow>(
          `select id::text, challenge_hash, expires_at, consumed_at
           from evidence_challenges
           where goal_id = $1 and owner_subject_key = $2 and attempt_number = $3
           for update`,
          [goalId, subjectKey, attemptNumber],
        )
        const challenge = challengeResult.rows[0]
        if (challenge === undefined || !challengeMatches(challenge.challenge_hash, challengeCode)) {
          throw new EvidenceServiceError("CHALLENGE_INVALID", 409)
        }
        if (challenge.consumed_at !== null) {
          throw new EvidenceServiceError("CHALLENGE_INVALID", 409)
        }
        if (now >= challenge.expires_at) {
          throw new EvidenceServiceError("CHALLENGE_EXPIRED", 409)
        }
        const duplicate = await client.query(
          "select 1 from evidence_uploads where sha256 = $1 limit 1",
          [image.sha256],
        )

        try {
          await options.objectStore.put({
            bytes: image.bytes,
            contentType: image.contentType,
            key: objectKey,
          })
          objectPut = true
        } catch {
          await deleteFailedObject(options.objectStore, objectKey)
          throw new EvidenceServiceError("QUARANTINE_UNAVAILABLE", 503)
        }

        await client.query(
          `insert into evidences(
             id, goal_id, owner_subject_key, attempt_number, business_key, state, received_at
           ) values ($1, $2, $3, $4, $5, 'pending', $6)`,
          [evidenceId, goalId, subjectKey, attemptNumber, receiptBusinessKey, now],
        )
        await client.query(
          `insert into evidence_uploads(
             evidence_id, object_key, content_type, byte_size, width, height, sha256,
             duplicate_signal, challenge_id, exif_stripped, created_at
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, $10)`,
          [
            evidenceId,
            objectKey,
            image.contentType,
            image.uploadedByteSize,
            image.width,
            image.height,
            image.sha256,
            duplicate.rowCount !== 0,
            challenge.id,
            now,
          ],
        )
        await client.query(
          `insert into verification_jobs(id, evidence_id, attempt_number, state, business_key, created_at)
           values ($1, $2, 1, 'queued', $3, $4)`,
          [options.uuid.create(), evidenceId, `evidence:${evidenceId}:review:1`, now],
        )
        await client.query(
          `insert into moderation_cases(id, evidence_id, goal_id, state, reason, created_at)
           values ($1, $2, $3, 'quarantined', 'awaiting_bounded_operator_review', $4)`,
          [options.uuid.create(), evidenceId, goalId, now],
        )
        await client.query(
          `insert into analytics_events(id, event_name, business_key, payload, occurred_at)
           values ($1, 'evidence_received', $2, $3::jsonb, $4)`,
          [
            options.uuid.create(),
            `evidence:${evidenceId}:received`,
            JSON.stringify({
              attemptNumber,
              goalId,
              receiptId: evidenceId,
              recipeId: evidenceRecipeV1.id,
              recipeVersion: evidenceRecipeV1.version,
            }),
            now,
          ],
        )
        await client.query("update evidence_challenges set consumed_at = $1 where id = $2", [
          now,
          challenge.id,
        ])
        await client.query("commit")
        return { receiptId: evidenceId, state: "pending" as const }
      } catch (error) {
        await client.query("rollback")
        if (objectPut) await deleteFailedObject(options.objectStore, objectKey)
        throw error
      } finally {
        client.release()
      }
    },
  }
}

export type EvidenceService = ReturnType<typeof createEvidenceService>
