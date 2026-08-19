import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { Kysely, PostgresDialect, sql } from "kysely"
import pg, { type PoolClient } from "pg"

type DatabaseSchema = Record<never, never>

export type DatabaseHandle = {
  readonly destroy: () => Promise<void>
  readonly kysely: Kysely<DatabaseSchema>
  readonly pool: pg.Pool
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
    destroy: async () => {
      const connectionsClosed =
        pool.totalCount === 0
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              let remainingConnections = pool.totalCount
              const handleRemove = (): void => {
                remainingConnections -= 1
                if (remainingConnections === 0) {
                  pool.off("remove", handleRemove)
                  resolve()
                }
              }
              pool.on("remove", handleRemove)
            })
      await kysely.destroy()
      await connectionsClosed
    },
    kysely,
    pool,
    ready: async () => {
      await sql`select 1`.execute(kysely)
    },
  }
}

const migrationsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../migrations")

async function migrationNames(direction: "up" | "down"): Promise<readonly string[]> {
  const names = (await readdir(migrationsDirectory))
    .filter((name) => name.endsWith(`.${direction}.sql`))
    .sort()
  return direction === "up" ? names : names.reverse()
}

async function applyMigration(
  client: PoolClient,
  name: string,
  direction: "up" | "down",
): Promise<void> {
  const sqlText = await readFile(join(migrationsDirectory, name), "utf8")
  const migrationName = name.replace(`.${direction}.sql`, "")
  await client.query("begin")
  try {
    await client.query(sqlText)
    if (direction === "up") {
      await client.query("insert into schema_migrations(name) values ($1)", [migrationName])
    } else {
      await client.query("delete from schema_migrations where name = $1", [migrationName])
    }
    await client.query("commit")
  } catch (error) {
    await client.query("rollback")
    throw error
  }
}

export async function migrateUp(database: DatabaseHandle): Promise<void> {
  await database.pool.query(
    "create table if not exists schema_migrations(name text primary key, applied_at timestamptz not null default clock_timestamp())",
  )
  const applied = await database.pool.query<{ readonly name: string }>(
    "select name from schema_migrations",
  )
  const appliedNames = new Set(applied.rows.map(({ name }) => name))
  const client = await database.pool.connect()
  try {
    for (const name of await migrationNames("up")) {
      if (!appliedNames.has(name.replace(".up.sql", ""))) await applyMigration(client, name, "up")
    }
  } finally {
    client.release()
  }
}

export async function migrateDown(database: DatabaseHandle): Promise<void> {
  const exists = await database.pool.query<{ readonly table_name: string | null }>(
    "select to_regclass('public.schema_migrations')::text as table_name",
  )
  if (exists.rows[0]?.table_name === null) return
  const applied = await database.pool.query<{ readonly name: string }>(
    "select name from schema_migrations",
  )
  const appliedNames = new Set(applied.rows.map(({ name }) => name))
  const client = await database.pool.connect()
  try {
    for (const name of await migrationNames("down")) {
      if (appliedNames.has(name.replace(".down.sql", "")))
        await applyMigration(client, name, "down")
    }
  } finally {
    client.release()
  }
  await database.pool.query("drop table schema_migrations")
}
