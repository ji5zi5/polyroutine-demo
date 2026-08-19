import { PgBoss } from "pg-boss"
import { ConfigurationError, parseConfig } from "./config.js"

async function main(): Promise<void> {
  const config = parseConfig(process.env)
  const boss = new PgBoss({ connectionString: config.DATABASE_URL })
  await boss.start()

  const shutdown = async (): Promise<void> => {
    await boss.stop({ graceful: true, timeout: 30_000 })
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
