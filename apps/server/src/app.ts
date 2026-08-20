import type {
  Clock,
  EvidenceObjectStore,
  EvidenceVerifier,
  UuidFactory,
} from "@polyroutine/contracts"
import type { DatabaseHandle } from "@polyroutine/db"
import Fastify from "fastify"
import type { AccountAuditSink } from "./modules/accounts/index.js"
import { registerAccountsRoutes } from "./modules/accounts/index.js"
import { registerEvidenceRoutes } from "./modules/evidence/routes.js"
import { createEvidenceService } from "./modules/evidence/service.js"
import { registerGoalRoutes } from "./modules/goals/routes.js"
import { createGoalService } from "./modules/goals/service.js"
import { serverModules } from "./modules/index.js"
import { registerModerationRoutes } from "./modules/moderation/routes.js"
import { createModerationService, type EvidenceUrlSigner } from "./modules/moderation/service.js"
import { registerPredictionRoutes } from "./modules/predictions/routes.js"
import { createPredictionService } from "./modules/predictions/service.js"

export type ServerOptions = {
  readonly accounts?: {
    readonly audit: AccountAuditSink
    readonly expectedOrigin: string
    readonly sessionSecret: string
  }
  readonly clock: Clock
  readonly database: DatabaseHandle
  readonly evidenceObjectStore: EvidenceObjectStore
  readonly evidenceVerifier: EvidenceVerifier
  readonly moderation?: {
    readonly claimLeaseMs?: number
    readonly queueLimit?: number
    readonly reviewSlaMs?: number
    readonly signer: EvidenceUrlSigner
  }
  readonly uuid: UuidFactory
}

export function createServer(options: ServerOptions) {
  const app = Fastify()
  app.decorate("evidenceObjectStore", options.evidenceObjectStore)
  app.decorate("evidenceVerifier", options.evidenceVerifier)
  if (options.accounts !== undefined) {
    registerAccountsRoutes(app, {
      audit: options.accounts.audit,
      clock: options.clock,
      database: options.database,
      expectedOrigin: options.accounts.expectedOrigin,
      sessionSecret: options.accounts.sessionSecret,
      uuid: options.uuid,
    })
  }
  registerGoalRoutes(
    app,
    createGoalService({
      clock: options.clock,
      database: options.database,
      uuid: options.uuid,
    }),
  )
  registerPredictionRoutes(
    app,
    createPredictionService({
      clock: options.clock,
      database: options.database,
      uuid: options.uuid,
    }),
  )
  registerEvidenceRoutes(
    app,
    createEvidenceService({
      clock: options.clock,
      database: options.database,
      objectStore: options.evidenceObjectStore,
      uuid: options.uuid,
    }),
  )
  if (options.moderation !== undefined) {
    registerModerationRoutes(
      app,
      createModerationService({
        clock: options.clock,
        database: options.database,
        objectStore: options.evidenceObjectStore,
        ...(options.moderation.claimLeaseMs === undefined
          ? {}
          : { claimLeaseMs: options.moderation.claimLeaseMs }),
        ...(options.moderation.queueLimit === undefined
          ? {}
          : { queueLimit: options.moderation.queueLimit }),
        ...(options.moderation.reviewSlaMs === undefined
          ? {}
          : { reviewSlaMs: options.moderation.reviewSlaMs }),
        signer: options.moderation.signer,
        uuid: options.uuid,
      }),
    )
  }

  app.get("/health/live", async () => ({
    checkedAt: options.clock.now().toISOString(),
    modules: serverModules.map(({ name }) => name),
    requestId: options.uuid.create(),
    status: "live" as const,
  }))

  app.get("/health/ready", async (_request, reply) => {
    try {
      await options.database.ready()
      return { status: "ready" as const }
    } catch (error) {
      if (error instanceof Error) {
        return reply.status(503).send({ status: "not_ready" as const })
      }
      throw error
    }
  })

  return app
}
