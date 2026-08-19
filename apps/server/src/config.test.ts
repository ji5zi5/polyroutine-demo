import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { ConfigurationError, parseConfig } from "./config.js"

const validEnvironment: NodeJS.ProcessEnv = {
  DATABASE_URL: "postgresql://poly:poly@127.0.0.1:5432/poly",
  HOST: "127.0.0.1",
  MONTHLY_COST_CAP_KRW: "100000",
  OBJECT_STORAGE_ACCESS_KEY: "test-access-key",
  OBJECT_STORAGE_BUCKET: "poly-routine-test-evidence",
  OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000",
  OBJECT_STORAGE_REGION: "ap-northeast-2",
  OBJECT_STORAGE_SECRET_KEY: "test-secret-key",
  PORT: "3001",
  PUBLIC_ORIGIN: "http://127.0.0.1:3000",
  SESSION_SECRET: "test-session-secret-at-least-32-characters",
}

describe("bootstrap startup configuration", () => {
  it("accepts the postgres URL scheme returned by Testcontainers", () => {
    // Given
    const environment = {
      ...validEnvironment,
      DATABASE_URL: "postgres://poly:poly@127.0.0.1:5432/poly",
    }

    // When
    const config = parseConfig(environment)

    // Then
    expect(config.DATABASE_URL).toBe(environment.DATABASE_URL)
  })

  it("throws an explicit config error when DATABASE_URL is missing", () => {
    // Given
    const environment = { ...validEnvironment, DATABASE_URL: undefined }

    // When
    const action = () => parseConfig(environment)

    // Then
    expect(action).toThrowError(ConfigurationError)
    expect(action).toThrowError(/DATABASE_URL/)
  })

  it("throws an explicit config error when SESSION_SECRET is missing", () => {
    // Given
    const environment = { ...validEnvironment, SESSION_SECRET: undefined }

    // When
    const action = () => parseConfig(environment)

    // Then
    expect(action).toThrowError(ConfigurationError)
    expect(action).toThrowError(/SESSION_SECRET/)
  })

  it("rejects every session secret shorter than 32 characters", () => {
    // Given
    const shortSecret = fc.string({ maxLength: 31 })

    // When / Then
    fc.assert(
      fc.property(shortSecret, (SESSION_SECRET) => {
        expect(() => parseConfig({ ...validEnvironment, SESSION_SECRET })).toThrowError(
          ConfigurationError,
        )
      }),
    )
  })
})
