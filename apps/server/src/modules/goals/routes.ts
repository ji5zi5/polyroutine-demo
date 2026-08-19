import type { FastifyInstance, FastifyReply } from "fastify"
import {
  cancelGoalSchema,
  GoalServiceError,
  goalIdSchema,
  guidedGoalFieldsSchema,
  idempotencyKeySchema,
  subjectKeySchema,
} from "./contract.js"
import type { GoalService } from "./service.js"

type GoalParams = { readonly goalId: string }

function sendInvalid(reply: FastifyReply, code: string) {
  return reply.status(400).send({ code })
}

function parseSubject(raw: unknown, reply: FastifyReply): string | null {
  const parsed = subjectKeySchema.safeParse(raw)
  if (!parsed.success) {
    reply.status(401).send({ code: "SUBJECT_REQUIRED" })
    return null
  }
  return parsed.data
}

export function registerGoalRoutes(app: FastifyInstance, service: GoalService): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof GoalServiceError) {
      return reply.status(error.statusCode).send({ code: error.code })
    }
    throw error
  })

  app.post("/v1/goals", async (request, reply) => {
    const subjectKey = parseSubject(request.headers["x-subject-key"], reply)
    if (subjectKey === null) return reply
    const body = guidedGoalFieldsSchema.safeParse(request.body)
    if (!body.success) return sendInvalid(reply, "INVALID_GOAL_REQUEST")
    return reply.status(201).send(await service.create(subjectKey, body.data))
  })

  app.get("/v1/goals/today", async (request, reply) => {
    const subjectKey = parseSubject(request.headers["x-subject-key"], reply)
    if (subjectKey === null) return reply
    return reply.send({ goal: await service.today(subjectKey) })
  })

  app.get<{ Params: GoalParams }>("/v1/goals/:goalId", async (request, reply) => {
    const subjectKey = parseSubject(request.headers["x-subject-key"], reply)
    if (subjectKey === null) return reply
    const goalId = goalIdSchema.safeParse(request.params.goalId)
    if (!goalId.success) return sendInvalid(reply, "INVALID_GOAL_ID")
    return reply.send(await service.get(subjectKey, goalId.data))
  })

  app.patch<{ Params: GoalParams }>("/v1/goals/:goalId", async (request, reply) => {
    const subjectKey = parseSubject(request.headers["x-subject-key"], reply)
    if (subjectKey === null) return reply
    const goalId = goalIdSchema.safeParse(request.params.goalId)
    const body = guidedGoalFieldsSchema.safeParse(request.body)
    if (!goalId.success) return sendInvalid(reply, "INVALID_GOAL_ID")
    if (!body.success) return sendInvalid(reply, "INVALID_GOAL_REQUEST")
    return reply.send(await service.update(subjectKey, goalId.data, body.data))
  })

  app.post<{ Params: GoalParams }>("/v1/goals/:goalId/cancel", async (request, reply) => {
    const subjectKey = parseSubject(request.headers["x-subject-key"], reply)
    if (subjectKey === null) return reply
    const goalId = goalIdSchema.safeParse(request.params.goalId)
    const idempotencyKey = idempotencyKeySchema.safeParse(request.headers["idempotency-key"])
    const body = cancelGoalSchema.safeParse(request.body)
    if (!goalId.success) return sendInvalid(reply, "INVALID_GOAL_ID")
    if (!idempotencyKey.success) return sendInvalid(reply, "IDEMPOTENCY_KEY_REQUIRED")
    if (!body.success) return sendInvalid(reply, "INVALID_CANCEL_REQUEST")
    return reply.send(
      await service.cancel({
        goalId: goalId.data,
        idempotencyKey: idempotencyKey.data,
        input: body.data,
        subjectKey,
      }),
    )
  })
}
