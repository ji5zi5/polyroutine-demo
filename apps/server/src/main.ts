import { ConfigurationError, parseConfig } from "./config.js"
import { createRuntime } from "./runtime.js"

async function main(): Promise<void> {
  const config = parseConfig(process.env)
  const runtime = createRuntime(config)

  try {
    await runtime.server.listen({ host: config.HOST, port: config.PORT })
  } catch (error) {
    await runtime.database.destroy()
    throw error
  }

  const shutdown = async (): Promise<void> => {
    await runtime.server.close()
    await runtime.database.destroy()
  }
  process.once("SIGINT", () => void shutdown())
  process.once("SIGTERM", () => void shutdown())
}

void main().catch((error: unknown) => {
  if (error instanceof ConfigurationError) {
    process.stderr.write(`Configuration error: ${error.message}\n`)
  } else if (error instanceof Error) {
    process.stderr.write(`Server startup failed: ${error.message}\n`)
  } else {
    process.stderr.write("Server startup failed with a non-Error value\n")
  }
  process.exitCode = 1
})
