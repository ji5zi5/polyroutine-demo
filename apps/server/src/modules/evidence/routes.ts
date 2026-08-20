import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import type { BrowserEvidenceUploadService } from "./browser-upload.js"
import { EvidenceServiceError } from "./errors.js"
import { acceptedEvidenceContentTypes, decodeEvidenceImage, EvidenceImageError } from "./image.js"
import type { EvidenceService } from "./service.js"

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const HTTP_BODY_LIMIT = MAX_UPLOAD_BYTES + 1
const goalIdSchema = z.uuid()
const subjectKeySchema = z.string().trim().min(1).max(200)
const idempotencyKeySchema = z.string().trim().min(1).max(128)
const evidenceContentTypeSchema = z.enum(acceptedEvidenceContentTypes)
const prepareUploadSchema = z.strictObject({
  byteSize: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
  challengeCode: z.string().trim().min(1).max(64),
  contentType: evidenceContentTypeSchema,
})
const completeUploadSchema = z.strictObject({
  challengeCode: z.string().trim().min(1).max(64),
  uploadId: z.uuid(),
})

type GoalParams = { readonly goalId: string }
type UploadParams = GoalParams & { readonly uploadId: string }

function subjectFrom(raw: unknown, reply: FastifyReply): string | null {
  const parsed = subjectKeySchema.safeParse(raw)
  if (parsed.success) return parsed.data
  reply.status(401).send({ code: "SUBJECT_REQUIRED" })
  return null
}

function sendEvidenceError(reply: FastifyReply, error: unknown) {
  if (error instanceof EvidenceServiceError || error instanceof EvidenceImageError) {
    return reply.status(error.statusCode).send({ code: error.code })
  }
  throw error
}

export function registerEvidenceRoutes(
  app: FastifyInstance,
  service: EvidenceService,
  browserUpload?: BrowserEvidenceUploadService,
): void {
  app.register(async (evidence) => {
    evidence.addContentTypeParser(
      [...acceptedEvidenceContentTypes],
      { bodyLimit: HTTP_BODY_LIMIT, parseAs: "buffer" },
      (_request, body, done) => done(null, body),
    )
    evidence.setErrorHandler((error, _request, reply) => {
      if (typeof error === "object" && error !== null) {
        if ("statusCode" in error && error.statusCode === 413) {
          return reply.status(413).send({ code: "IMAGE_TOO_LARGE" })
        }
        if ("code" in error && error.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE") {
          return reply.status(415).send({ code: "IMAGE_TYPE_MISMATCH" })
        }
      }
      return reply.send(error)
    })

    evidence.post<{ Params: GoalParams }>(
      "/v1/goals/:goalId/evidence/challenge",
      async (request, reply) => {
        const subjectKey = subjectFrom(request.headers["x-subject-key"], reply)
        if (subjectKey === null) return reply
        const goalId = goalIdSchema.safeParse(request.params.goalId)
        if (!goalId.success) return reply.status(400).send({ code: "INVALID_GOAL_ID" })
        try {
          return reply.status(201).send(await service.challenge(subjectKey, goalId.data))
        } catch (error) {
          if (error instanceof EvidenceServiceError) return sendEvidenceError(reply, error)
          throw error
        }
      },
    )

    if (browserUpload !== undefined) {
      evidence.post<{ Body: unknown; Params: GoalParams }>(
        "/v1/goals/:goalId/evidence/presign",
        async (request, reply) => {
          const subjectKey = subjectFrom(request.headers["x-subject-key"], reply)
          if (subjectKey === null) return reply
          const goalId = goalIdSchema.safeParse(request.params.goalId)
          if (!goalId.success) return reply.status(400).send({ code: "INVALID_GOAL_ID" })
          const idempotencyKey = idempotencyKeySchema.safeParse(request.headers["idempotency-key"])
          if (!idempotencyKey.success) {
            return reply.status(400).send({ code: "INVALID_IDEMPOTENCY_KEY" })
          }
          const input = prepareUploadSchema.safeParse(request.body)
          if (!input.success) return reply.status(400).send({ code: "INVALID_UPLOAD_REQUEST" })
          try {
            return reply.status(201).send(
              await browserUpload.prepare(subjectKey, goalId.data, {
                ...input.data,
                idempotencyKey: idempotencyKey.data,
              }),
            )
          } catch (error) {
            return sendEvidenceError(reply, error)
          }
        },
      )

      evidence.post<{ Body: unknown; Params: GoalParams }>(
        "/v1/goals/:goalId/evidence/complete",
        async (request, reply) => {
          const subjectKey = subjectFrom(request.headers["x-subject-key"], reply)
          if (subjectKey === null) return reply
          const goalId = goalIdSchema.safeParse(request.params.goalId)
          if (!goalId.success) return reply.status(400).send({ code: "INVALID_GOAL_ID" })
          const input = completeUploadSchema.safeParse(request.body)
          if (!input.success) return reply.status(400).send({ code: "INVALID_UPLOAD_REQUEST" })
          try {
            const receipt = await browserUpload.complete(subjectKey, goalId.data, input.data)
            return reply.status(202).send({ receipt_id: receipt.receiptId, state: receipt.state })
          } catch (error) {
            return sendEvidenceError(reply, error)
          }
        },
      )

      evidence.delete<{ Params: UploadParams }>(
        "/v1/goals/:goalId/evidence/uploads/:uploadId",
        async (request, reply) => {
          const subjectKey = subjectFrom(request.headers["x-subject-key"], reply)
          if (subjectKey === null) return reply
          const goalId = goalIdSchema.safeParse(request.params.goalId)
          const uploadId = z.uuid().safeParse(request.params.uploadId)
          if (!goalId.success || !uploadId.success) {
            return reply.status(400).send({ code: "INVALID_UPLOAD_REQUEST" })
          }
          try {
            await browserUpload.cancel(subjectKey, goalId.data, uploadId.data)
            return reply.status(204).send()
          } catch (error) {
            return sendEvidenceError(reply, error)
          }
        },
      )
    }

    evidence.get<{ Params: GoalParams }>("/v1/goals/:goalId/evidence", async (request, reply) => {
      const subjectKey = subjectFrom(request.headers["x-subject-key"], reply)
      if (subjectKey === null) return reply
      const goalId = goalIdSchema.safeParse(request.params.goalId)
      if (!goalId.success) return reply.status(400).send({ code: "INVALID_GOAL_ID" })
      try {
        return reply.send({ evidence: await service.status(subjectKey, goalId.data) })
      } catch (error) {
        if (error instanceof EvidenceServiceError) return sendEvidenceError(reply, error)
        throw error
      }
    })

    evidence.post<{ Params: GoalParams }>(
      "/v1/goals/:goalId/evidence",
      { bodyLimit: HTTP_BODY_LIMIT },
      async (request, reply) => {
        const subjectKey = subjectFrom(request.headers["x-subject-key"], reply)
        if (subjectKey === null) return reply
        const goalId = goalIdSchema.safeParse(request.params.goalId)
        if (!goalId.success) return reply.status(400).send({ code: "INVALID_GOAL_ID" })
        if (!Buffer.isBuffer(request.body)) {
          return reply.status(415).send({ code: "IMAGE_TYPE_MISMATCH" })
        }
        if (request.body.byteLength > MAX_UPLOAD_BYTES) {
          return reply.status(413).send({ code: "IMAGE_TOO_LARGE" })
        }
        const contentType = request.headers["content-type"]
        if (typeof contentType !== "string") {
          return reply.status(415).send({ code: "IMAGE_TYPE_MISMATCH" })
        }
        const challengeCode = request.headers["x-evidence-challenge"]
        const rawIdempotencyKey = request.headers["idempotency-key"]
        const idempotencyKey =
          rawIdempotencyKey === undefined
            ? undefined
            : idempotencyKeySchema.safeParse(rawIdempotencyKey)
        if (idempotencyKey !== undefined && !idempotencyKey.success) {
          return reply.status(400).send({ code: "INVALID_IDEMPOTENCY_KEY" })
        }
        try {
          const image = await decodeEvidenceImage(request.body, contentType)
          const receipt = await service.submit(
            subjectKey,
            goalId.data,
            typeof challengeCode === "string" ? challengeCode : undefined,
            image,
            idempotencyKey?.data,
          )
          return reply.status(202).send({ receipt_id: receipt.receiptId, state: receipt.state })
        } catch (error) {
          if (error instanceof EvidenceImageError) {
            await service.quarantineRejected(subjectKey, goalId.data, error.code)
          }
          return sendEvidenceError(reply, error)
        }
      },
    )
  })
}
