import { createDatabase, migrateUp } from "@polyroutine/db"
import type { TestPostgres } from "@polyroutine/testing"
import { startTestPostgres } from "@polyroutine/testing"
import type { FastifyInstance } from "fastify"
import { request } from "undici"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import type { AccountAuditEvent } from "../src/modules/accounts/index.js"
import {
  sendAccountRequest as send,
  accountSessionResponseSchema as sessionResponseSchema,
  signupPayload,
  accountSignupResponseSchema as signupResponseSchema,
  startAccountTestServer,
} from "./accounts-test-support.js"

describe("accounts boundary integration", () => {
  let address = ""
  let auditEvents: AccountAuditEvent[] = []
  let database: ReturnType<typeof createDatabase> | undefined
  let postgres: TestPostgres | undefined
  let server: FastifyInstance | undefined

  beforeAll(async () => {
    postgres = await startTestPostgres()
    database = createDatabase(postgres.connectionString)
    await migrateUp(database)
    const fixture = await startAccountTestServer(database)
    address = fixture.address
    auditEvents = fixture.auditEvents
    server = fixture.server
  }, 120_000)

  afterAll(async () => {
    if (server !== undefined) await server.close()
    if (database !== undefined) await database.destroy()
    if (postgres !== undefined) await postgres.container.stop()
  })

  beforeEach(async () => {
    const handle = database
    if (handle === undefined) throw new TypeError("database fixture is unavailable")
    await handle.pool.query("truncate users cascade")
    await handle.pool.query("truncate login_rate_limits")
    auditEvents.length = 0
  })

  it("creates an adult account with Argon2id and hashed opaque session secrets", async () => {
    // Given / When
    const response = await send({
      address,
      method: "POST",
      path: "/v1/accounts/signup",
      payload: signupPayload,
    })

    // Then
    expect(response.statusCode).toBe(201)
    const created = signupResponseSchema.parse(response.body)
    const handle = database
    if (handle === undefined) throw new TypeError("database fixture is unavailable")
    const stored = await handle.pool.query<{
      readonly csrf_hash: string
      readonly password_hash: string
      readonly token_hash: string
    }>("select password_hash, token_hash, csrf_hash from accounts join sessions using(subject_key)")
    expect(stored.rows[0]?.password_hash).toMatch(/^\$argon2id\$/)
    expect(stored.rows[0]?.token_hash).not.toBe(created.session.token)
    expect(stored.rows[0]?.csrf_hash).not.toBe(created.session.csrfToken)
    const auditSnapshot = JSON.stringify(auditEvents)
    expect(auditSnapshot).not.toContain(signupPayload.email)
    expect(auditSnapshot).not.toContain(signupPayload.password)
    expect(auditSnapshot).not.toContain(created.session.token)
  })

  it("rejects non-adult, malformed, and cross-origin signup without persistence", async () => {
    // Given / When
    const nonAdult = await send({
      address,
      method: "POST",
      path: "/v1/accounts/signup",
      payload: { ...signupPayload, adultSelfAttested: false },
    })
    const malformed = await send({
      address,
      method: "POST",
      path: "/v1/accounts/signup",
      payload: { ...signupPayload, email: "<script>alert(1)</script>" },
    })
    const foreignOrigin = await request(`${address}/v1/accounts/signup`, {
      body: JSON.stringify(signupPayload),
      headers: { "content-type": "application/json", origin: "https://attacker.invalid" },
      method: "POST",
    })
    await foreignOrigin.body.text()

    // Then
    expect([nonAdult.statusCode, malformed.statusCode, foreignOrigin.statusCode]).toEqual([
      400, 400, 403,
    ])
    const handle = database
    if (handle === undefined) throw new TypeError("database fixture is unavailable")
    const count = await handle.pool.query<{ readonly count: string }>(
      "select count(*) from accounts",
    )
    expect(count.rows[0]?.count).toBe("0")
  })

  it("enforces CSRF, rotates sessions, and revokes the family on token reuse", async () => {
    // Given
    const signup = await send({
      address,
      method: "POST",
      path: "/v1/accounts/signup",
      payload: signupPayload,
    })
    const first = signupResponseSchema.parse(signup.body).session
    const authHeaders = { authorization: `Bearer ${first.token}`, "x-csrf-token": first.csrfToken }

    // When
    const missingCsrf = await send({
      address,
      headers: { authorization: `Bearer ${first.token}` },
      method: "POST",
      path: "/v1/accounts/session/rotate",
    })
    const rotation = await send({
      address,
      headers: authHeaders,
      method: "POST",
      path: "/v1/accounts/session/rotate",
    })
    const second = sessionResponseSchema.parse(rotation.body).session
    const reuse = await send({
      address,
      headers: authHeaders,
      method: "POST",
      path: "/v1/accounts/session/rotate",
    })
    const afterReuse = await send({
      address,
      headers: { authorization: `Bearer ${second.token}`, "x-csrf-token": second.csrfToken },
      method: "POST",
      path: "/v1/accounts/session/rotate",
    })

    // Then
    expect([
      missingCsrf.statusCode,
      rotation.statusCode,
      reuse.statusCode,
      afterReuse.statusCode,
    ]).toEqual([403, 200, 409, 401])
    expect(auditEvents.some(({ kind }) => kind === "session_reuse_detected")).toBe(true)
  })

  it("resets the password and revokes every prior session", async () => {
    // Given
    const signup = signupResponseSchema.parse(
      (await send({ address, method: "POST", path: "/v1/accounts/signup", payload: signupPayload }))
        .body,
    )
    const login = sessionResponseSchema.parse(
      (
        await send({
          address,
          method: "POST",
          path: "/v1/accounts/login",
          payload: {
            email: signupPayload.email,
            password: signupPayload.password,
          },
        })
      ).body,
    )

    // When
    const reset = await send({
      address,
      headers: {
        authorization: `Bearer ${signup.session.token}`,
        "x-csrf-token": signup.session.csrfToken,
      },
      method: "POST",
      path: "/v1/accounts/password/reset",
      payload: {
        currentPassword: signupPayload.password,
        newPassword: "new correct horse battery staple",
      },
    })

    // Then
    expect(reset.statusCode).toBe(200)
    const priorSession = await send({
      address,
      headers: {
        authorization: `Bearer ${login.session.token}`,
        "x-csrf-token": login.session.csrfToken,
      },
      method: "POST",
      path: "/v1/accounts/session/rotate",
    })
    expect(priorSession.statusCode).toBe(401)
  })

  it("limits brute-force login and supports all-session logout", async () => {
    // Given
    const signup = await send({
      address,
      method: "POST",
      path: "/v1/accounts/signup",
      payload: signupPayload,
    })
    const first = signupResponseSchema.parse(signup.body).session
    const second = sessionResponseSchema.parse(
      (
        await send({
          address,
          method: "POST",
          path: "/v1/accounts/login",
          payload: { email: signupPayload.email, password: signupPayload.password },
        })
      ).body,
    ).session
    const loginPayload = { email: signupPayload.email, password: "wrong password" }

    // When
    const attempts: number[] = []
    for (let index = 0; index < 5; index += 1) {
      attempts.push(
        (await send({ address, method: "POST", path: "/v1/accounts/login", payload: loginPayload }))
          .statusCode,
      )
    }
    const blocked = await send({
      address,
      method: "POST",
      path: "/v1/accounts/login",
      payload: { email: signupPayload.email, password: signupPayload.password },
    })

    // Then
    expect(attempts).toEqual([401, 401, 401, 401, 401])
    expect(blocked.statusCode).toBe(429)
    const logoutAll = await send({
      address,
      headers: { authorization: `Bearer ${first.token}`, "x-csrf-token": first.csrfToken },
      method: "POST",
      path: "/v1/accounts/logout-all",
    })
    expect(logoutAll.statusCode).toBe(204)
    const revokedSecondSession = await send({
      address,
      headers: { authorization: `Bearer ${second.token}`, "x-csrf-token": second.csrfToken },
      method: "POST",
      path: "/v1/accounts/session/rotate",
    })
    expect(revokedSecondSession.statusCode).toBe(401)
  })
})
