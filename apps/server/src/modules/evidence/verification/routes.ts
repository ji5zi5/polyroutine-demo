import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import type { OperatorDecision } from "./contract.js"
import { type VerificationService, VerificationServiceError } from "./service.js"

const decisionSchema = z.discriminatedUnion("verdict", [
  z.strictObject({ verdict: z.literal("accepted") }),
  z.strictObject({
    reasonCode: z.enum(["recipe_mismatch", "challenge_not_visible", "notes_insufficient"]),
    verdict: z.literal("rejected"),
  }),
  z.strictObject({
    reasonCode: z.enum(["image_unreadable", "review_unavailable"]),
    verdict: z.literal("inconclusive"),
  }),
])
const idempotencyKeySchema = z.string().trim().min(1).max(128)
const operatorSubjectSchema = z.string().trim().min(1).max(200)
const reviewParamsSchema = z.strictObject({ reviewId: z.uuid() })
const leaseTokenSchema = z.uuid()

type ReviewParams = { readonly reviewId: string }

function sendServiceError(reply: FastifyReply, error: unknown) {
  if (error instanceof VerificationServiceError) {
    return reply.status(error.statusCode).send({ code: error.code })
  }
  throw error
}

export function registerVerificationRoutes(
  app: FastifyInstance,
  service: VerificationService,
): void {
  app.post("/v1/operator/evidence-reviews/claim", async (request, reply) => {
    const operator = operatorSubjectSchema.safeParse(request.headers["x-operator-subject-key"])
    if (!operator.success) return reply.status(400).send({ code: "OPERATOR_REQUIRED" })
    try {
      const review = await service.claim(operator.data)
      if (review === null) return reply.status(204).send()
      return reply.send(review)
    } catch (error) {
      return sendServiceError(reply, error)
    }
  })

  app.post<{ Params: ReviewParams }>(
    "/v1/operator/evidence-reviews/:reviewId/decision",
    async (request, reply) => {
      const params = reviewParamsSchema.safeParse(request.params)
      const body = decisionSchema.safeParse(request.body)
      const operator = operatorSubjectSchema.safeParse(request.headers["x-operator-subject-key"])
      const leaseToken = leaseTokenSchema.safeParse(request.headers["x-review-lease-token"])
      const idempotencyKey = idempotencyKeySchema.safeParse(request.headers["idempotency-key"])
      if (
        !params.success ||
        !body.success ||
        !operator.success ||
        !leaseToken.success ||
        !idempotencyKey.success
      ) {
        return reply.status(400).send({ code: "INVALID_VERDICT_REQUEST" })
      }
      try {
        return await service.decide({
          decision: body.data satisfies OperatorDecision,
          idempotencyKey: idempotencyKey.data,
          leaseToken: leaseToken.data,
          operatorSubjectKey: operator.data,
          reviewId: params.data.reviewId,
        })
      } catch (error) {
        return sendServiceError(reply, error)
      }
    },
  )
}
