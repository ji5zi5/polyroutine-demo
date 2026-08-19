import { randomUUID } from "node:crypto"
import type { DatabaseHandle } from "@polyroutine/db"
import type { FastifyInstance } from "fastify"
import { request } from "undici"
import { z } from "zod"
import { createServer } from "../src/app.js"
import type { AccountAuditEvent } from "../src/modules/accounts/index.js"

export const ACCOUNT_ORIGIN = "http://127.0.0.1:3100"

export const signupPayload = {
  adultSelfAttested: true,
  email: "adult@example.test",
  password: "correct horse battery staple",
  privacyVersion: "2026-08-19",
  termsVersion: "2026-08-19",
  timezone: "Asia/Seoul",
} as const

export type AccountTestServer = {
  readonly address: string
  readonly auditEvents: AccountAuditEvent[]
  readonly server: FastifyInstance
}

export async function startAccountTestServer(database: DatabaseHandle): Promise<AccountTestServer> {
  const auditEvents: AccountAuditEvent[] = []
  const server = createServer({
    accounts: {
      audit: { write: (event) => auditEvents.push(event) },
      expectedOrigin: ACCOUNT_ORIGIN,
      sessionSecret: "test-session-secret-at-least-32-characters",
    },
    clock: { now: () => new Date("2026-08-19T00:00:00.000Z") },
    database,
    evidenceObjectStore: { delete: async () => undefined, put: async () => undefined },
    evidenceVerifier: { review: async () => ({ kind: "operator_review_required" }) },
    uuid: { create: randomUUID },
  })
  const address = await server.listen({ host: "127.0.0.1", port: 0 })
  return { address, auditEvents, server }
}

export const accountSessionSchema = z.object({
  csrfToken: z.string(),
  expiresAt: z.string(),
  token: z.string(),
})
export const accountSignupResponseSchema = z.object({
  session: accountSessionSchema,
  subjectKey: z.string(),
})
export const accountSessionResponseSchema = z.object({ session: accountSessionSchema })

export async function sendAccountRequest(options: {
  readonly address: string
  readonly headers?: Readonly<Record<string, string>>
  readonly method: "DELETE" | "POST"
  readonly path: string
  readonly payload?: Readonly<Record<string, unknown>>
}) {
  const response = await request(`${options.address}${options.path}`, {
    body: options.payload === undefined ? null : JSON.stringify(options.payload),
    headers: {
      ...(options.payload === undefined ? {} : { "content-type": "application/json" }),
      origin: ACCOUNT_ORIGIN,
      ...options.headers,
    },
    method: options.method,
  })
  const text = await response.body.text()
  return { body: text.length === 0 ? null : JSON.parse(text), statusCode: response.statusCode }
}
