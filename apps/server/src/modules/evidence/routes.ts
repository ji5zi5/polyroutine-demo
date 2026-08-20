import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import { EvidenceServiceError } from "./errors.js"
import { acceptedEvidenceContentTypes, decodeEvidenceImage, EvidenceImageError } from "./image.js"
import type { EvidenceService } from "./service.js"

const MAX_UPLOAD_BYTES = 8 * 1024 * 1024
const HTTP_BODY_LIMIT = MAX_UPLOAD_BYTES + 1
const goalIdSchema = z.uuid()
const subjectKeySchema = z.string().trim().min(1).max(200)
const idempotencyKeySchema = z.string().trim().min(1).max(128)

type GoalParams = { readonly goalId: string }

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

export function registerEvidenceRoutes(app: FastifyInstance, service: EvidenceService): void {
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
          return sendEvidenceError(reply, error)
        }
      },
    )

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
