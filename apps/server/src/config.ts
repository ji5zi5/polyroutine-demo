import { z } from "zod"

const runtimeConfigSchema = z.object({
  DATABASE_URL: z.url({ protocol: /^postgres(?:ql)?$/ }),
  HOST: z.string().default("127.0.0.1"),
  MONTHLY_COST_CAP_KRW: z.coerce.number().int().positive().max(100_000),
  OBJECT_STORAGE_ACCESS_KEY: z.string().min(1),
  OBJECT_STORAGE_BUCKET: z.string().min(3),
  OBJECT_STORAGE_ENDPOINT: z.url(),
  OBJECT_STORAGE_REGION: z.string().min(1),
  OBJECT_STORAGE_SECRET_KEY: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
  PUBLIC_ORIGIN: z.url(),
  SESSION_SECRET: z.string().min(32),
})

export type RuntimeConfig = Readonly<z.infer<typeof runtimeConfigSchema>>

export class ConfigurationError extends Error {
  override readonly name = "ConfigurationError"

  constructor(readonly fields: readonly string[]) {
    super(`invalid startup configuration: ${fields.join(", ")}`)
  }
}

export function parseConfig(environment: NodeJS.ProcessEnv): RuntimeConfig {
  const result = runtimeConfigSchema.safeParse(environment)
  if (!result.success) {
    throw new ConfigurationError(
      result.error.issues.map((issue) => issue.path.join(".") || "environment"),
    )
  }
  return result.data
}
