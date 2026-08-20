import type { FastifyInstance, FastifyReply } from "fastify"
import { z } from "zod"
import { ModerationError, type ModerationService } from "./service.js"

const idSchema = z.uuid()
const reportSchema = z.object({
  reasonCode: z.enum(["prohibited_content", "personal_data", "malware", "other"]),
  targetId: z.uuid(),
  targetType: z.enum(["evidence", "goal"]),
})
const verdictSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(128),
  reason: z.string().trim().min(1).max(1_000),
  verdict: z.enum(["accepted", "rejected", "inconclusive"]),
})
const cancelSchema = verdictSchema.omit({ verdict: true })

type IdParams = { readonly id: string }

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof ModerationError) {
    return reply.status(error.statusCode).send({ code: error.code })
  }
  throw error
}

function operator(request: { readonly headers: Record<string, unknown> }): string | undefined {
  const value = request.headers["x-operator-key"]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function registerModerationRoutes(app: FastifyInstance, service: ModerationService): void {
  app.get("/v1/safety/policy", async () => service.policy())

  app.post("/v1/moderation/reports", async (request, reply) => {
    const subject = request.headers["x-subject-key"]
    if (typeof subject !== "string" || subject.length === 0) {
      return reply.status(401).send({ code: "SUBJECT_REQUIRED" })
    }
    const body = reportSchema.safeParse(request.body)
    if (!body.success) return reply.status(400).send({ code: "INVALID_REPORT" })
    try {
      const result = await service.report(subject, body.data)
      return reply.status(201).send({ case_id: result.caseId, state: result.state })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post<{ Params: IdParams }>("/operator/cases/:id/claim", async (request, reply) => {
    if (!idSchema.safeParse(request.params.id).success) {
      return reply.status(400).send({ code: "INVALID_CASE_ID" })
    }
    try {
      const result = await service.claim(operator(request), request.params.id)
      return reply.send({ claimed_by: result.claimedBy, lease_expires_at: result.leaseExpiresAt })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post<{ Params: IdParams }>("/operator/cases/:id/access", async (request, reply) => {
    if (!idSchema.safeParse(request.params.id).success) {
      return reply.status(400).send({ code: "INVALID_CASE_ID" })
    }
    try {
      const result = await service.access(operator(request), request.params.id)
      return reply.send({ expires_at: result.expiresAt, url: result.url })
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post<{ Params: IdParams }>("/operator/cases/:id/resolve", async (request, reply) => {
    const body = verdictSchema.safeParse(request.body)
    if (!idSchema.safeParse(request.params.id).success || !body.success) {
      return reply.status(400).send({ code: "INVALID_DECISION" })
    }
    try {
      return reply.send(await service.resolve(operator(request), request.params.id, body.data))
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post<{ Params: IdParams }>("/operator/evidences/:id/corrections", async (request, reply) => {
    const body = verdictSchema.safeParse(request.body)
    if (!idSchema.safeParse(request.params.id).success || !body.success) {
      return reply.status(400).send({ code: "INVALID_CORRECTION" })
    }
    try {
      return reply.send(await service.correct(operator(request), request.params.id, body.data))
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post<{ Params: IdParams }>("/operator/goals/:id/cancel", async (request, reply) => {
    const body = cancelSchema.safeParse(request.body)
    if (!idSchema.safeParse(request.params.id).success || !body.success) {
      return reply.status(400).send({ code: "INVALID_CANCELLATION" })
    }
    try {
      return reply.send(await service.cancelGoal(operator(request), request.params.id, body.data))
    } catch (error) {
      return sendError(reply, error)
    }
  })

  app.post("/operator/retention/run", async (request, reply) => {
    try {
      return reply.send(await service.runRetention(operator(request)))
    } catch (error) {
      return sendError(reply, error)
    }
  })
}
