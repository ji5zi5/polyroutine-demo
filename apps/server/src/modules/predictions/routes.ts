import type { FastifyInstance, FastifyReply } from "fastify"
import {
  exposureInputSchema,
  PredictionServiceError,
  predictionGoalIdSchema,
  predictionIdempotencyKeySchema,
  predictionInputSchema,
  predictionSubjectSchema,
} from "./contract.js"
import type { PredictionService } from "./service.js"

type GoalParams = { readonly goalId: string }

function subjectFrom(raw: unknown, reply: FastifyReply): string | null {
  const parsed = predictionSubjectSchema.safeParse(raw)
  if (parsed.success) return parsed.data
  reply.status(401).send({ code: "SUBJECT_REQUIRED" })
  return null
}

function idempotencyKeyFrom(raw: unknown, reply: FastifyReply): string | null {
  const parsed = predictionIdempotencyKeySchema.safeParse(raw)
  if (parsed.success) return parsed.data
  reply.status(400).send({ code: "IDEMPOTENCY_KEY_REQUIRED" })
  return null
}

async function handle<T>(reply: FastifyReply, action: () => Promise<T>): Promise<T | FastifyReply> {
  try {
    return await action()
  } catch (error) {
    if (error instanceof PredictionServiceError) {
      return reply
        .status(error.statusCode)
        .send({ code: error.code, replacement: error.replacement })
    }
    throw error
  }
}

export function registerPredictionRoutes(app: FastifyInstance, service: PredictionService): void {
  app.get("/v1/predictions/feed", async (request, reply) => {
    const subjectKey = subjectFrom(request.headers["x-subject-key"], reply)
    if (subjectKey === null) return reply
    return handle(reply, () => service.feed(subjectKey))
  })

  app.post("/v1/predictions/exposures", async (request, reply) => {
    const subjectKey = subjectFrom(request.headers["x-subject-key"], reply)
    if (subjectKey === null) return reply
    const idempotencyKey = idempotencyKeyFrom(request.headers["idempotency-key"], reply)
    if (idempotencyKey === null) return reply
    const input = exposureInputSchema.safeParse(request.body)
    if (!input.success) return reply.status(400).send({ code: "INVALID_EXPOSURE_REQUEST" })
    const result = await handle(reply, () =>
      service.expose(subjectKey, input.data.goalId, idempotencyKey),
    )
    if ("statusCode" in result) return result
    return reply.status(result.created ? 201 : 200).send({
      exposedAt: result.exposure.exposed_at.toISOString(),
      exposureId: result.exposure.id,
      goalId: result.exposure.goal_id,
    })
  })

  app.post<{ Params: GoalParams }>("/v1/predictions/:goalId", async (request, reply) => {
    const subjectKey = subjectFrom(request.headers["x-subject-key"], reply)
    if (subjectKey === null) return reply
    const idempotencyKey = idempotencyKeyFrom(request.headers["idempotency-key"], reply)
    if (idempotencyKey === null) return reply
    const goalId = predictionGoalIdSchema.safeParse(request.params.goalId)
    const input = predictionInputSchema.safeParse(request.body)
    if (!goalId.success || !input.success) {
      return reply.status(400).send({ code: "INVALID_PREDICTION_REQUEST" })
    }
    const result = await handle(reply, () =>
      service.predict(subjectKey, goalId.data, input.data.choice, idempotencyKey),
    )
    if ("statusCode" in result) return result
    return reply.status(result.replayed ? 200 : 201).send(result.prediction)
  })
}
