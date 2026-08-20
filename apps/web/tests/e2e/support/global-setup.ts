import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { createDatabase, migrateUp } from "@polyroutine/db"
import { createServer } from "@polyroutine/server"
import { startTestPostgres } from "@polyroutine/testing"
import { z } from "zod"

const API_PORT = 3101
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`
const WEB_ORIGIN = "http://127.0.0.1:3100"
const evidenceTask = process.env["POLYROUTINE_EVIDENCE_TASK"] ?? "task-7"
const evidenceDirectory = path.resolve(
  import.meta.dirname,
  `../../../../../.omo/evidence/${evidenceTask}`,
)
const INITIAL_SERVER_TIME = "2099-08-20T00:00:00.000Z"
const serverTimeSchema = z.object({ iso: z.iso.datetime() })
const evidenceVerdictSchema = z.discriminatedUnion("state", [
  z.strictObject({
    reasonCode: z.enum(["challenge_not_visible", "notes_insufficient", "recipe_mismatch"]),
    state: z.literal("rejected"),
  }),
  z.strictObject({
    reasonCode: z.enum(["image_unreadable", "review_unavailable"]),
    state: z.literal("inconclusive"),
  }),
])
const uuidSchema = z.uuid()
const extraQaPidSchema = z.coerce.number().int().positive().optional()
const objectUploadQuerySchema = z.object({
  expires: z.coerce.number().int().positive(),
  key: z.string().startsWith("quarantine-pending/"),
})

type BrowserUploadStore = NonNullable<
  Parameters<typeof createServer>[0]["evidenceBrowserUploadStore"]
>
type EvidenceObjectKey = Parameters<BrowserUploadStore["get"]>[0]
type StoredEvidenceObject = NonNullable<Awaited<ReturnType<BrowserUploadStore["get"]>>>
type EvidenceUploadTarget = Parameters<BrowserUploadStore["signUpload"]>[0]
type ObjectUploadQuery = {
  readonly expires: string
  readonly key: string
}
type ObjectUploadReply = {
  header(name: string, value: string): ObjectUploadReply
  send(payload?: unknown): unknown
  status(code: number): ObjectUploadReply
}
type ObjectUploadRequest = {
  readonly body: unknown
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>
  readonly query: unknown
}

async function globalSetup(): Promise<() => Promise<void>> {
  const testDatabaseUrl = process.env["TEST_DATABASE_URL"]
  const extraQaPid = extraQaPidSchema.parse(process.env["POLYROUTINE_EXTRA_QA_PID"])
  const postgres = testDatabaseUrl === undefined ? await startTestPostgres() : undefined
  const connectionString = testDatabaseUrl ?? postgres?.connectionString
  if (connectionString === undefined) throw new TypeError("test database connection is missing")
  const database = createDatabase(connectionString)
  await migrateUp(database)
  let serverTime = new Date(INITIAL_SERVER_TIME)
  const evidenceObjects = new Map<EvidenceObjectKey, StoredEvidenceObject>()
  const signedUploadKeys = new Map<string, EvidenceObjectKey>()
  const evidenceObjectStore = {
    delete: async (key: EvidenceObjectKey) => {
      evidenceObjects.delete(key)
    },
    get: async (key: EvidenceObjectKey) => evidenceObjects.get(key) ?? null,
    put: async (object: StoredEvidenceObject) => {
      evidenceObjects.set(object.key, object)
    },
    signUpload: async (target: EvidenceUploadTarget, expiresAt: Date) => {
      signedUploadKeys.set(target.key, target.key)
      const url = new URL("/__e2e/object-upload", API_ORIGIN)
      url.searchParams.set("key", target.key)
      url.searchParams.set("expires", String(expiresAt.getTime()))
      return url.toString()
    },
  }

  const server = createServer({
    accounts: {
      audit: { write: () => undefined },
      expectedOrigin: WEB_ORIGIN,
      sessionSecret: "task-7-session-secret-at-least-32-characters",
    },
    clock: { now: () => new Date(serverTime) },
    database,
    evidenceBrowserUploadStore: evidenceObjectStore,
    evidenceObjectStore,
    uuid: { create: randomUUID },
  })

  server.addContentTypeParser(
    "application/octet-stream",
    { bodyLimit: 8 * 1024 * 1024 + 1, parseAs: "buffer" },
    (_request: unknown, body: Buffer, done: (error: Error | null, body: Buffer) => void) =>
      done(null, body),
  )
  server.options("/__e2e/object-upload", async (_request: unknown, reply: ObjectUploadReply) =>
    reply
      .header("access-control-allow-headers", "content-type")
      .header("access-control-allow-methods", "PUT")
      .header("access-control-allow-origin", WEB_ORIGIN)
      .status(204)
      .send(),
  )
  server.put<{ Body: Buffer; Querystring: ObjectUploadQuery }>(
    "/__e2e/object-upload",
    async (request: ObjectUploadRequest, reply: ObjectUploadReply) => {
      const query = objectUploadQuerySchema.parse(request.query)
      if (serverTime.getTime() >= query.expires) return reply.status(403).send()
      if (!Buffer.isBuffer(request.body)) return reply.status(415).send()
      const contentType = request.headers["content-type"]
      if (typeof contentType !== "string") return reply.status(415).send()
      const key = signedUploadKeys.get(query.key)
      if (key === undefined) return reply.status(404).send()
      evidenceObjects.set(key, { bytes: request.body, contentType, key })
      return reply.header("access-control-allow-origin", WEB_ORIGIN).status(204).send()
    },
  )

  server.post("/__e2e/reset", async () => {
    serverTime = new Date(INITIAL_SERVER_TIME)
    const result = await database.pool.query<{ readonly tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations' order by tablename",
    )
    const identifiers = result.rows.map(({ tablename }) => `"${tablename.replaceAll('"', '""')}"`)
    if (identifiers.length > 0) {
      await database.pool.query(`truncate table ${identifiers.join(", ")} cascade`)
    }
    evidenceObjects.clear()
    signedUploadKeys.clear()
    return { reset: true }
  })

  server.post("/__e2e/clock", async (request: { readonly body: unknown }) => {
    serverTime = new Date(serverTimeSchema.parse(request.body).iso)
    return { iso: serverTime.toISOString() }
  })

  server.post<{ Params: { readonly goalId: string } }>(
    "/__e2e/goals/:goalId/evidence-open",
    async (request: { readonly params: { readonly goalId: string } }) => {
      const goalId = uuidSchema.parse(request.params.goalId)
      const result = await database.pool.query(
        "update goals set state = 'evidence_open' where id = $1 returning id",
        [goalId],
      )
      if (result.rowCount !== 1) throw new TypeError("e2e goal fixture is missing")
      return { goalId, state: "evidence_open" as const }
    },
  )

  server.get<{ Params: { readonly goalId: string } }>(
    "/__e2e/evidence/:goalId/contract",
    async (request: { readonly params: { readonly goalId: string } }) => {
      const goalId = uuidSchema.parse(request.params.goalId)
      const evidence = await database.pool.query<{
        readonly attempt_number: number
        readonly content_type: string
        readonly receipt_id: string
        readonly state: string
      }>(
        `select e.id::text as receipt_id, e.attempt_number, e.state, u.content_type
         from evidences e join evidence_uploads u on u.evidence_id = e.id
         where e.goal_id = $1 order by e.attempt_number`,
        [goalId],
      )
      const objectCount = [...evidenceObjects.keys()].filter((key) =>
        key.startsWith(`quarantine/${goalId}/`),
      ).length
      const pendingObjectCount = [...evidenceObjects.keys()].filter((key) =>
        key.startsWith(`quarantine-pending/${goalId}/`),
      ).length
      return { evidence: evidence.rows, objectCount, pendingObjectCount }
    },
  )

  server.post<{
    Body: unknown
    Params: { readonly evidenceId: string }
  }>(
    "/__e2e/evidence/:evidenceId/verdict",
    async (request: {
      readonly body: unknown
      readonly params: { readonly evidenceId: string }
    }) => {
      const evidenceId = uuidSchema.parse(request.params.evidenceId)
      const verdict = evidenceVerdictSchema.parse(request.body)
      const result = await database.pool.query(
        `with updated as (
           update evidences set state = $2 where id = $1 returning id
         )
         insert into evidence_verdict_events(
           evidence_id, operator_subject_key, verdict, reason_code, business_key, resolved_at
         )
         select id, 'e2e-operator', $2, $3, $4, $5 from updated
         returning evidence_id`,
        [evidenceId, verdict.state, verdict.reasonCode, `e2e-verdict:${evidenceId}`, serverTime],
      )
      if (result.rowCount !== 1) throw new TypeError("e2e evidence fixture is missing")
      return { evidenceId, state: verdict.state }
    },
  )

  server.get<{ Params: { readonly subjectKey: string } }>(
    "/__e2e/predictions/:subjectKey/count",
    async (request: { readonly params: { readonly subjectKey: string } }) => {
      const result = await database.pool.query<{ readonly count: string }>(
        "select count(*)::text as count from predictions where predictor_subject_key = $1",
        [request.params.subjectKey],
      )
      return { count: Number(result.rows[0]?.count ?? "0") }
    },
  )

  try {
    await server.listen({ host: "127.0.0.1", port: API_PORT })
    await mkdir(evidenceDirectory, { recursive: true })
    await writeFile(
      path.join(evidenceDirectory, "resources.json"),
      `${JSON.stringify(
        {
          browserPids: [],
          containerIds: postgres === undefined ? [] : [postgres.container.getId()],
          pids: extraQaPid === undefined ? [process.pid] : [process.pid, extraQaPid],
          ports: [3100, API_PORT],
          tempDirs: [],
        },
        null,
        2,
      )}\n`,
      "utf8",
    )
  } catch (error) {
    await server.close()
    await database.destroy()
    if (postgres !== undefined) await postgres.container.stop()
    throw error
  }

  return async () => {
    await server.close()
    await database.destroy()
    if (postgres !== undefined) await postgres.container.stop()
  }
}

export { globalSetup as default }
