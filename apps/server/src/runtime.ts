import { randomUUID } from "node:crypto"
import type { EvidenceVerifier } from "@polyroutine/contracts"
import { createDatabase } from "@polyroutine/db"
import { createServer } from "./app.js"
import type { RuntimeConfig } from "./config.js"
import { S3EvidenceObjectStore } from "./evidence-object-store.js"

const boundedOperatorVerifier: EvidenceVerifier = {
  review: async () => ({ kind: "operator_review_required" }),
}

export function createRuntime(config: RuntimeConfig) {
  const database = createDatabase(config.DATABASE_URL)
  const evidenceObjectStore = new S3EvidenceObjectStore({
    accessKeyId: config.OBJECT_STORAGE_ACCESS_KEY,
    bucket: config.OBJECT_STORAGE_BUCKET,
    endpoint: config.OBJECT_STORAGE_ENDPOINT,
    region: config.OBJECT_STORAGE_REGION,
    secretAccessKey: config.OBJECT_STORAGE_SECRET_KEY,
  })
  const server = createServer({
    accounts: {
      audit: { write: () => undefined },
      expectedOrigin: config.PUBLIC_ORIGIN,
      sessionSecret: config.SESSION_SECRET,
    },
    clock: { now: () => new Date() },
    database,
    evidenceObjectStore,
    evidenceVerifier: boundedOperatorVerifier,
    moderation: {
      claimLeaseMs: config.MODERATION_CLAIM_LEASE_SECONDS * 1_000,
      queueLimit: config.MODERATION_QUEUE_LIMIT,
      reviewSlaMs: config.MODERATION_REVIEW_SLA_HOURS * 60 * 60 * 1_000,
      signer: evidenceObjectStore,
    },
    uuid: { create: randomUUID },
  })
  return { database, server }
}
