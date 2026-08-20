import type { Clock, EvidenceBrowserUploadStore, UuidFactory } from "@polyroutine/contracts"
import type { DatabaseHandle } from "@polyroutine/db"
import { createUploadIntentRepository, type PrepareUploadInput } from "./browser-upload-intent.js"
import { EvidenceServiceError } from "./errors.js"
import { decodeEvidenceImage, EvidenceImageError } from "./image.js"
import type { EvidenceService } from "./service.js"

type CompleteUploadInput = {
  readonly challengeCode: string
  readonly uploadId: string
}

type BrowserUploadOptions = {
  readonly clock: Clock
  readonly database: DatabaseHandle
  readonly objectStore: EvidenceBrowserUploadStore
  readonly submission: EvidenceService
  readonly uuid: UuidFactory
}

function shouldDiscard(error: EvidenceServiceError): boolean {
  switch (error.code) {
    case "CHALLENGE_EXPIRED":
    case "CHALLENGE_INVALID":
    case "CHALLENGE_REQUIRED":
    case "EVIDENCE_ATTEMPTS_EXHAUSTED":
    case "EVIDENCE_DEADLINE":
    case "EVIDENCE_NOT_OPEN":
    case "GOAL_NOT_FOUND":
    case "IDEMPOTENCY_CONFLICT":
    case "UPLOAD_INTENT_NOT_FOUND":
    case "UPLOAD_NOT_FOUND":
      return true
    case "QUARANTINE_CLEANUP_FAILED":
    case "QUARANTINE_UNAVAILABLE":
      return false
  }
}

export function createBrowserEvidenceUploadService(options: BrowserUploadOptions) {
  const intents = createUploadIntentRepository(options)
  return {
    cancel: async (subjectKey: string, goalId: string, uploadId: string): Promise<void> => {
      const row = await intents.find(subjectKey, goalId, uploadId)
      if (row.completed_evidence_id === null) await intents.discard(row)
    },

    complete: async (subjectKey: string, goalId: string, input: CompleteUploadInput) => {
      const row = await intents.find(subjectKey, goalId, input.uploadId)
      if (row.completed_evidence_id !== null) {
        return { receiptId: row.completed_evidence_id, state: "pending" as const }
      }
      const now = options.clock.now()
      if (now >= row.evidence_deadline_at) {
        await intents.discard(row)
        throw new EvidenceServiceError("EVIDENCE_DEADLINE", 409)
      }
      if (now >= row.expires_at || now >= row.challenge_expires_at) {
        await intents.discard(row)
        throw new EvidenceServiceError("CHALLENGE_EXPIRED", 409)
      }
      const object = await options.objectStore.get(row.object_key)
      if (object === null) throw new EvidenceServiceError("UPLOAD_NOT_FOUND", 409)
      try {
        if (object.bytes.byteLength !== row.byte_size) {
          throw new EvidenceImageError("IMAGE_TYPE_MISMATCH", 415)
        }
        const image = await decodeEvidenceImage(object.bytes, row.content_type)
        const receipt = await options.submission.submit(
          subjectKey,
          goalId,
          input.challengeCode,
          image,
          row.idempotency_key,
        )
        await options.database.pool.query(
          "update evidence_upload_intents set completed_evidence_id = $2 where id = $1",
          [row.id, receipt.receiptId],
        )
        await options.objectStore.delete(row.object_key)
        return receipt
      } catch (error) {
        if (error instanceof EvidenceImageError) {
          await options.submission.quarantineRejected(subjectKey, goalId, error.code)
          await intents.discard(row)
          throw error
        }
        if (error instanceof EvidenceServiceError && shouldDiscard(error)) {
          await intents.discard(row)
        }
        throw error
      }
    },

    prepare: (subjectKey: string, goalId: string, input: PrepareUploadInput) =>
      intents.prepare(subjectKey, goalId, input),
  }
}

export type BrowserEvidenceUploadService = ReturnType<typeof createBrowserEvidenceUploadService>
