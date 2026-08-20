import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import { AccountsService, type RotateSessionResult } from "./service.js"
import {
  type AccountsDependencies,
  type AuthFailure,
  type AuthResult,
  loginInputSchema,
  passwordResetInputSchema,
  signupInputSchema,
} from "./types.js"

function requestCredentials(request: FastifyRequest): {
  readonly csrfToken: string
  readonly token: string
} | null {
  const authorization = request.headers.authorization
  const csrfToken = request.headers["x-csrf-token"]
  if (authorization === undefined || !authorization.startsWith("Bearer ")) return null
  if (typeof csrfToken !== "string") return null
  const token = authorization.slice("Bearer ".length)
  if (token.length === 0 || token.includes(" ")) return null
  return { csrfToken, token }
}

async function authenticateRequest(
  service: AccountsService,
  request: FastifyRequest,
): Promise<AuthResult> {
  if (typeof request.headers["x-csrf-token"] !== "string") return { kind: "csrf_rejected" }
  const credentials = requestCredentials(request)
  if (credentials === null) return { kind: "invalid_session" }
  return service.authenticate(credentials.token, credentials.csrfToken)
}

function sendAuthFailure(reply: FastifyReply, failure: AuthFailure) {
  switch (failure.kind) {
    case "csrf_rejected":
      return reply.status(403).send({ error: "csrf_rejected" })
    case "invalid_session":
      return reply.status(401).send({ error: "invalid_session" })
    case "session_reused":
      return reply.status(409).send({ error: "session_reused" })
  }
}

function sendRotation(reply: FastifyReply, result: RotateSessionResult) {
  switch (result.kind) {
    case "csrf_rejected":
    case "invalid_session":
    case "session_reused":
      return sendAuthFailure(reply, result)
    case "rotated":
      return reply.status(200).send({ session: result.session })
  }
}

export function registerAccountsRoutes(
  app: FastifyInstance,
  dependencies: AccountsDependencies,
): void {
  const service = new AccountsService(dependencies)

  app.register(async (accounts) => {
    accounts.addHook("preHandler", async (request, reply) => {
      if (request.headers.origin !== dependencies.expectedOrigin) {
        return reply.status(403).send({ error: "origin_rejected" })
      }
    })

    accounts.post("/v1/accounts/signup", async (request, reply) => {
      const parsed = signupInputSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ error: "invalid_request" })
      const result = await service.signup(parsed.data)
      switch (result.kind) {
        case "created":
          return reply.status(201).send(result)
        case "email_conflict":
          return reply.status(409).send({ error: "email_conflict" })
      }
    })

    accounts.post("/v1/accounts/login", async (request, reply) => {
      const parsed = loginInputSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ error: "invalid_request" })
      const result = await service.login(parsed.data, request.ip)
      switch (result.kind) {
        case "authenticated":
          return reply.status(200).send({ session: result.session, subjectKey: result.subjectKey })
        case "credentials_rejected":
          return reply.status(401).send({ error: "credentials_rejected" })
        case "rate_limited":
          return reply.status(429).send({ error: "rate_limited" })
      }
    })

    accounts.post("/v1/accounts/password/reset", async (request, reply) => {
      const parsed = passwordResetInputSchema.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ error: "invalid_request" })
      const authentication = await authenticateRequest(service, request)
      if (authentication.kind !== "authenticated") return sendAuthFailure(reply, authentication)
      const result = await service.resetPassword(authentication.actor, parsed.data)
      switch (result.kind) {
        case "current_password_rejected":
          return reply.status(401).send({ error: "current_password_rejected" })
        case "reset":
          return reply.status(200).send({ session: result.session })
      }
    })

    accounts.post("/v1/accounts/session/rotate", async (request, reply) => {
      if (typeof request.headers["x-csrf-token"] !== "string")
        return reply.status(403).send({ error: "csrf_rejected" })
      const credentials = requestCredentials(request)
      if (credentials === null) return reply.status(401).send({ error: "invalid_session" })
      return sendRotation(reply, await service.rotate(credentials.token, credentials.csrfToken))
    })

    accounts.post("/v1/accounts/logout", async (request, reply) => {
      const authentication = await authenticateRequest(service, request)
      if (authentication.kind !== "authenticated") return sendAuthFailure(reply, authentication)
      await service.logout(authentication.actor)
      return reply.status(204).send()
    })

    accounts.post("/v1/accounts/logout-all", async (request, reply) => {
      const authentication = await authenticateRequest(service, request)
      if (authentication.kind !== "authenticated") return sendAuthFailure(reply, authentication)
      await service.logoutAll(authentication.actor)
      return reply.status(204).send()
    })

    accounts.delete("/v1/accounts/me", async (request, reply) => {
      const authentication = await authenticateRequest(service, request)
      if (authentication.kind !== "authenticated") return sendAuthFailure(reply, authentication)
      return reply.status(200).send(await service.deleteAccount(authentication.actor))
    })
  })
}
