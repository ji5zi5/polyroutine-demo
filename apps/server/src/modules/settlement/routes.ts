import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import { CorrectionServiceError, type SettlementService } from "./service.js"

const correctionSchema = z.strictObject({
  correctedState: z.enum(["completed", "failed", "expired", "cancelled"]),
  reason: z.string().trim().min(1).max(500),
})
const goalParamsSchema = z.strictObject({ goalId: z.uuid() })
const idempotencyKeySchema = z.string().trim().min(1).max(128)
const operatorSubjectSchema = z.string().trim().min(1).max(200)

type GoalParams = { readonly goalId: string }

function correctionError(reply: FastifyReply, error: unknown) {
  if (error instanceof CorrectionServiceError) {
    return reply.status(error.statusCode).send({ code: error.code })
  }
  throw error
}

export function registerSettlementRoutes(app: FastifyInstance, service: SettlementService): void {
  app.post<{ Params: GoalParams }>(
    "/v1/operator/goals/:goalId/corrections",
    async (request, reply) => {
      const params = goalParamsSchema.safeParse(request.params)
      const body = correctionSchema.safeParse(request.body)
      const operator = operatorSubjectSchema.safeParse(request.headers["x-operator-subject-key"])
      const idempotencyKey = idempotencyKeySchema.safeParse(request.headers["idempotency-key"])
      if (!params.success || !body.success || !operator.success || !idempotencyKey.success) {
        return reply.status(400).send({ code: "INVALID_CORRECTION_REQUEST" })
      }
      try {
        return await service.correct({
          correctedState: body.data.correctedState,
          goalId: params.data.goalId,
          idempotencyKey: idempotencyKey.data,
          operatorSubjectKey: operator.data,
          reason: body.data.reason,
        })
      } catch (error) {
        return correctionError(reply, error)
      }
    },
  )
}
