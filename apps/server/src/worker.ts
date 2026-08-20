import { randomUUID } from "node:crypto"
import { createDatabase } from "@polyroutine/db"
import { PgBoss } from "pg-boss"
import { ConfigurationError, parseConfig } from "./config.js"
import { createVerificationService } from "./modules/evidence/verification/service.js"
import { registerVerificationWorker } from "./modules/evidence/verification/worker.js"

async function main(): Promise<void> {
  const config = parseConfig(process.env)
  const database = createDatabase(config.DATABASE_URL)
  const boss = new PgBoss({ connectionString: config.DATABASE_URL })
  try {
    await boss.start()
    await registerVerificationWorker(
      boss,
      database,
      createVerificationService({
        clock: { now: () => new Date() },
        database,
        uuid: { create: randomUUID },
      }),
    )
  } catch (error) {
    await boss.stop({ graceful: false })
    await database.destroy()
    throw error
  }

  const shutdown = async (): Promise<void> => {
    await boss.stop({ graceful: true, timeout: 30_000 })
    await database.destroy()
  }
  process.once("SIGINT", () => void shutdown())
  process.once("SIGTERM", () => void shutdown())
}

void main().catch((error: unknown) => {
  if (error instanceof ConfigurationError) {
    process.stderr.write(`Configuration error: ${error.message}\n`)
  } else if (error instanceof Error) {
    process.stderr.write(`Worker startup failed: ${error.message}\n`)
  } else {
    process.stderr.write("Worker startup failed with a non-Error value\n")
  }
  process.exitCode = 1
})
