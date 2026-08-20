import { randomUUID } from "node:crypto"
import type { EvidenceObjectStore } from "@polyroutine/contracts"
import { createDatabase, migrateUp } from "@polyroutine/db"
import { startTestPostgres, type TestPostgres } from "@polyroutine/testing"
import type { FastifyInstance, LightMyRequestResponse } from "fastify"
import { createServer } from "../src/app.js"

export const OWNER = "settlement-owner"
export const PREDICTORS = ["predictor-a", "predictor-b", "predictor-c"] as const
export const OPERATOR = "settlement-operator"
const INITIAL_NOW = new Date("2026-08-19T01:00:00.000Z")
const evidenceObjectStore: EvidenceObjectStore = {
  delete: async () => undefined,
  put: async () => undefined,
}

type EvidenceFixture = {
  readonly evidenceId: string
  readonly goalId: string
  readonly verificationJobId: string
}

type EvidenceOptions = {
  readonly attemptNumber?: 1 | 2
  readonly choices?: readonly ("yes" | "no")[]
  readonly deadline?: Date
  readonly owner?: string
}

export class SettlementHarness {
  connectionString = ""
  database: ReturnType<typeof createDatabase> | undefined
  now = new Date(INITIAL_NOW)
  postgres: TestPostgres | undefined
  server: FastifyInstance | undefined

  async start(): Promise<void> {
    const { TEST_DATABASE_URL: connectionString } = process.env
    if (connectionString === undefined) {
      this.postgres = await startTestPostgres()
      this.connectionString = this.postgres.connectionString
    } else {
      this.connectionString = connectionString
    }
    this.database = createDatabase(this.connectionString)
    await migrateUp(this.database)
    this.server = createServer({
      clock: { now: () => new Date(this.now) },
      database: this.database,
      evidenceObjectStore,
      operatorReviewPolicy: {
        leaseMilliseconds: 15 * 60 * 1_000,
        maxLeaseAttempts: 3,
        maxQueueDepth: 1,
      },
      uuid: { create: randomUUID },
    })
    await this.server.ready()
  }

  async stop(): Promise<void> {
    if (this.server !== undefined) await this.server.close()
    if (this.database !== undefined) await this.database.destroy()
    if (this.postgres !== undefined) await this.postgres.container.stop()
  }

  async reset(): Promise<void> {
    const database = this.requireDatabase()
    this.now = new Date(INITIAL_NOW)
    await database.pool.query("truncate users cascade")
    await database.pool.query(
      "truncate reputation_events, goal_correction_events, analytics_events",
    )
    await database.pool.query(
      `insert into users(subject_key, timezone)
       select subject_key, 'UTC' from unnest($1::text[]) subject_key`,
      [[OWNER, ...PREDICTORS]],
    )
  }

  requireDatabase(): ReturnType<typeof createDatabase> {
    if (this.database === undefined) throw new TypeError("database fixture is unavailable")
    return this.database
  }

  requireServer(): FastifyInstance {
    if (this.server === undefined) throw new TypeError("server fixture is unavailable")
    return this.server
  }

  async createEvidence(options: EvidenceOptions = {}): Promise<EvidenceFixture> {
    const database = this.requireDatabase()
    const goalId = randomUUID()
    const evidenceId = randomUUID()
    const verificationJobId = randomUUID()
    const owner = options.owner ?? OWNER
    if (owner !== OWNER) {
      await database.pool.query(
        "insert into users(subject_key, timezone) values ($1, 'UTC') on conflict do nothing",
        [owner],
      )
    }
    await database.pool.query(
      `insert into goals(id, owner_subject_key, local_goal_date, recipe_id, recipe_version,
         goal_copy, prediction_cutoff_at, evidence_deadline_at, state)
       values ($1, $2, $3, 'study_note_photo_v1', 1, '{}',
         '2099-01-01T00:00:00Z', '2099-01-02T00:00:00Z', 'prediction_open')`,
      [goalId, owner, this.now.toISOString().slice(0, 10)],
    )
    for (const [index, choice] of (options.choices ?? []).entries()) {
      const predictor = PREDICTORS[index]
      if (predictor === undefined) throw new TypeError("prediction fixture exceeds known users")
      await database.pool.query(
        `insert into predictions(goal_id, predictor_subject_key, choice, business_key)
         values ($1, $2, $3, $4)`,
        [goalId, predictor, choice, `prediction:${goalId}:${index}`],
      )
    }
    await database.pool.query(
      `update goals set prediction_cutoff_at = $1, evidence_deadline_at = $2,
         state = 'evidence_open' where id = $3`,
      [
        new Date(this.now.getTime() - 1_000),
        options.deadline ?? new Date(this.now.getTime() + 60 * 60 * 1_000),
        goalId,
      ],
    )
    await database.pool.query(
      `insert into evidences(id, goal_id, owner_subject_key, attempt_number, business_key, state,
         received_at) values ($1, $2, $3, $4, $5, 'pending', $6)`,
      [
        evidenceId,
        goalId,
        owner,
        options.attemptNumber ?? 1,
        `evidence:${evidenceId}:receipt`,
        this.now,
      ],
    )
    await database.pool.query(
      `insert into verification_jobs(id, evidence_id, attempt_number, state, business_key)
       values ($1, $2, 1, 'queued', $3)`,
      [verificationJobId, evidenceId, `evidence:${evidenceId}:review:1`],
    )
    return { evidenceId, goalId, verificationJobId }
  }

  claim(operator = OPERATOR): Promise<LightMyRequestResponse> {
    return this.requireServer().inject({
      headers: { "x-operator-subject-key": operator },
      method: "POST",
      url: "/v1/operator/evidence-reviews/claim",
    })
  }

  decide(
    reviewId: string,
    leaseToken: string,
    body: Readonly<Record<string, unknown>>,
    idempotencyKey: string,
  ): Promise<LightMyRequestResponse> {
    return this.requireServer().inject({
      body,
      headers: {
        "idempotency-key": idempotencyKey,
        "x-operator-subject-key": OPERATOR,
        "x-review-lease-token": leaseToken,
      },
      method: "POST",
      url: `/v1/operator/evidence-reviews/${reviewId}/decision`,
    })
  }
}
