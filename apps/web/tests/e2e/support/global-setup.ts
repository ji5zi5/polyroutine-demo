import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { createDatabase, migrateUp } from "@polyroutine/db"
import { createServer } from "@polyroutine/server"
import { startTestPostgres } from "@polyroutine/testing"
import { z } from "zod"

const API_PORT = 3101
const WEB_ORIGIN = "http://127.0.0.1:3100"
const evidenceDirectory = path.resolve(import.meta.dirname, "../../../../../.omo/evidence/task-7")
const INITIAL_SERVER_TIME = "2099-08-20T00:00:00.000Z"
const serverTimeSchema = z.object({ iso: z.iso.datetime() })

async function globalSetup(): Promise<() => Promise<void>> {
  const postgres = await startTestPostgres()
  const database = createDatabase(postgres.connectionString)
  await migrateUp(database)
  let serverTime = new Date(INITIAL_SERVER_TIME)

  const server = createServer({
    accounts: {
      audit: { write: () => undefined },
      expectedOrigin: WEB_ORIGIN,
      sessionSecret: "task-7-session-secret-at-least-32-characters",
    },
    clock: { now: () => new Date(serverTime) },
    database,
    evidenceObjectStore: { delete: async () => undefined, put: async () => undefined },
    uuid: { create: randomUUID },
  })

  server.post("/__e2e/reset", async () => {
    serverTime = new Date(INITIAL_SERVER_TIME)
    const result = await database.pool.query<{ readonly tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migrations' order by tablename",
    )
    const identifiers = result.rows.map(({ tablename }) => `"${tablename.replaceAll('"', '""')}"`)
    if (identifiers.length > 0) {
      await database.pool.query(`truncate table ${identifiers.join(", ")} cascade`)
    }
    return { reset: true }
  })

  server.post("/__e2e/clock", async (request: { readonly body: unknown }) => {
    serverTime = new Date(serverTimeSchema.parse(request.body).iso)
    return { iso: serverTime.toISOString() }
  })

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
          containerIds: [postgres.container.getId()],
          pids: [process.pid],
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
    await postgres.container.stop()
    throw error
  }

  return async () => {
    await server.close()
    await database.destroy()
    await postgres.container.stop()
  }
}

export { globalSetup as default }
