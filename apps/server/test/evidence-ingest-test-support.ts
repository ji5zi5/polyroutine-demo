import { randomUUID } from "node:crypto"
import type {
  EvidenceObject,
  EvidenceObjectKey,
  EvidenceObjectStore,
  EvidenceVerifier,
} from "@polyroutine/contracts"
import { createDatabase, migrateUp } from "@polyroutine/db"
import { startTestPostgres, type TestPostgres } from "@polyroutine/testing"
import type { FastifyInstance } from "fastify"
import { request } from "undici"
import { createServer } from "../src/app.js"

export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
)
export const OWNER = "evidence-owner"
export const OTHER_OWNER = "other-owner"

class MemoryEvidenceStore implements EvidenceObjectStore {
  readonly objects = new Map<EvidenceObjectKey, EvidenceObject>()
  failPut = false

  async delete(key: EvidenceObjectKey): Promise<void> {
    this.objects.delete(key)
  }

  async put(object: EvidenceObject): Promise<void> {
    if (this.failPut) throw new TypeError("object storage unavailable")
    this.objects.set(object.key, object)
  }
}

type SendOptions = {
  readonly body?: Uint8Array
  readonly challengeCode?: string
  readonly contentType?: string
  readonly idempotencyKey?: string
  readonly owner?: string
}

type JsonResponse = {
  readonly body: {
    readonly [key: string]: unknown
    readonly code?: unknown
    readonly receipt_id?: unknown
    readonly state?: unknown
  }
  readonly statusCode: number
}

export class EvidenceHarness {
  address = ""
  database: ReturnType<typeof createDatabase> | undefined
  now = new Date("2026-08-19T01:00:00.000Z")
  postgres: TestPostgres | undefined
  server: FastifyInstance | undefined
  readonly store = new MemoryEvidenceStore()
  readonly uuidValues: string[] = []
  verifierCalls = 0
  readonly verifier: EvidenceVerifier = {
    review: async () => {
      this.verifierCalls += 1
      return { kind: "operator_review_required" }
    },
  }

  async start(): Promise<void> {
    this.postgres = await startTestPostgres()
    this.database = createDatabase(this.postgres.connectionString)
    await migrateUp(this.database)
    this.server = createServer({
      clock: { now: () => new Date(this.now) },
      database: this.database,
      evidenceObjectStore: this.store,
      evidenceVerifier: this.verifier,
      uuid: { create: () => this.uuidValues.shift() ?? randomUUID() },
    })
    this.address = await this.server.listen({ host: "127.0.0.1", port: 0 })
  }

  async stop(): Promise<void> {
    if (this.server !== undefined) await this.server.close()
    if (this.database !== undefined) await this.database.destroy()
    if (this.postgres !== undefined) await this.postgres.container.stop()
  }

  async reset(): Promise<void> {
    const database = this.requireDatabase()
    this.now = new Date("2026-08-19T01:00:00.000Z")
    this.store.failPut = false
    this.store.objects.clear()
    this.uuidValues.length = 0
    this.verifierCalls = 0
    await database.pool.query("truncate users cascade")
    await database.pool.query("truncate analytics_events")
    await database.pool.query(
      "insert into users(subject_key, timezone) values ($1, 'Asia/Seoul'), ($2, 'Asia/Seoul')",
      [OWNER, OTHER_OWNER],
    )
  }

  requireDatabase(): ReturnType<typeof createDatabase> {
    if (this.database === undefined) throw new TypeError("database fixture is unavailable")
    return this.database
  }

  async createGoal(
    options: { readonly deadline?: Date; readonly owner?: string } = {},
  ): Promise<string> {
    const goalId = randomUUID()
    await this.requireDatabase().pool.query(
      `insert into goals(id, owner_subject_key, local_goal_date, recipe_id, recipe_version,
         goal_copy, prediction_cutoff_at, evidence_deadline_at, state)
       values ($1, $2, $3, 'study_note_photo_v1', 1, '{}', $4, $5, 'evidence_open')`,
      [
        goalId,
        options.owner ?? OWNER,
        this.now.toISOString().slice(0, 10),
        new Date(this.now.getTime() - 1_000),
        options.deadline ?? new Date(this.now.getTime() + 60 * 60 * 1_000),
      ],
    )
    return goalId
  }

  async send(path: string, options: SendOptions = {}): Promise<JsonResponse> {
    const response = await request(`${this.address}${path}`, {
      ...(options.body === undefined ? {} : { body: options.body }),
      headers: {
        ...(options.challengeCode === undefined
          ? {}
          : { "x-evidence-challenge": options.challengeCode }),
        ...(options.contentType === undefined ? {} : { "content-type": options.contentType }),
        ...(options.idempotencyKey === undefined
          ? {}
          : { "idempotency-key": options.idempotencyKey }),
        "x-subject-key": options.owner ?? OWNER,
      },
      method: "POST",
    })
    const text = await response.body.text()
    return { body: text.length === 0 ? {} : JSON.parse(text), statusCode: response.statusCode }
  }

  async challenge(goalId: string, owner = OWNER): Promise<string> {
    const response = await this.send(`/v1/goals/${goalId}/evidence/challenge`, { owner })
    if (response.statusCode !== 201 || typeof response.body.code !== "string") {
      throw new TypeError(`challenge failed: ${response.statusCode}`)
    }
    return response.body.code
  }

  upload(goalId: string, options: SendOptions = {}): Promise<JsonResponse> {
    return this.send(`/v1/goals/${goalId}/evidence`, {
      body: options.body ?? PNG,
      ...(options.challengeCode === undefined ? {} : { challengeCode: options.challengeCode }),
      contentType: options.contentType ?? "image/png",
      ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
      ...(options.owner === undefined ? {} : { owner: options.owner }),
    })
  }
}
