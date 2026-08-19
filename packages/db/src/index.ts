import { Kysely, PostgresDialect, sql } from "kysely"
import pg from "pg"

type DatabaseSchema = Record<never, never>

export type DatabaseHandle = {
  readonly destroy: () => Promise<void>
  readonly kysely: Kysely<DatabaseSchema>
  readonly ready: () => Promise<void>
}

export function createDatabase(connectionString: string): DatabaseHandle {
  const pool = new pg.Pool({
    connectionString,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    max: 5,
  })
  const kysely = new Kysely<DatabaseSchema>({ dialect: new PostgresDialect({ pool }) })

  return {
    destroy: async () => kysely.destroy(),
    kysely,
    ready: async () => {
      await sql`select 1`.execute(kysely)
    },
  }
}
