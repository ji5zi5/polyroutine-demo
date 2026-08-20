import { createHash, timingSafeEqual } from "node:crypto"
import type { Clock, UuidFactory } from "@polyroutine/contracts"
import { evidenceRecipeV1 } from "@polyroutine/contracts"
import type { DatabaseHandle } from "@polyroutine/db"
import { EvidenceServiceError } from "./errors.js"
import { assertOwnedOpenGoal, type EvidenceGoalRow } from "./goal.js"

const CHALLENGE_PREFIX = "PR-"

type EvidenceChallengeOptions = {
  readonly clock: Clock
  readonly database: DatabaseHandle
  readonly uuid: UuidFactory
}

function challengeHash(code: string): string {
  return createHash("sha256").update(code, "utf8").digest("hex")
}

export function challengeMatches(expectedHash: string, code: string): boolean {
  const actual = Buffer.from(challengeHash(code), "hex")
  const expected = Buffer.from(expectedHash, "hex")
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

function createChallengeCode(uuid: string): string {
  return `${CHALLENGE_PREFIX}${uuid.replaceAll("-", "").slice(0, 8).toUpperCase()}`
}

export async function createEvidenceChallenge(
  options: EvidenceChallengeOptions,
  subjectKey: string,
  goalId: string,
) {
  const now = options.clock.now()
  const expiresAt = new Date(
    now.getTime() + evidenceRecipeV1.capture.challengeExpiresInSeconds * 1_000,
  )
  const challengeId = options.uuid.create()
  const code = createChallengeCode(options.uuid.create())
  const client = await options.database.pool.connect()
  await client.query("begin")
  try {
    const goalResult = await client.query<EvidenceGoalRow>(
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
}
