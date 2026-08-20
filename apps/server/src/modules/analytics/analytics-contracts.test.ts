import { glob, readFile } from "node:fs/promises"
import { analyticsEventNames, analyticsEventSchema } from "@polyroutine/contracts"
import { describe, expect, it } from "vitest"

const goalId = "00000000-0000-4000-8000-000000000001"
const cohort = {
  actorSubjectKey: "subject-predictor",
  eventVersion: 1,
  goalId,
  localCohortDate: "2026-08-20",
  recipeId: "study_note_photo_v1",
  recipeVersion: 1,
  timezone: "Asia/Seoul",
} as const

const eventFixtures = [
  { ...cohort, eventName: "goal_listed" },
  { ...cohort, eventName: "prediction_exposed" },
  { ...cohort, choice: "yes", eventName: "prediction_submitted" },
  {
    actorSubjectKey: cohort.actorSubjectKey,
    eventName: "prediction_shortage_shown",
    eventVersion: 1,
    localCohortDate: cohort.localCohortDate,
    reasonCode: "eligible_pool_exhausted",
    requestedCount: 5,
    returnedCount: 3,
    timezone: cohort.timezone,
  },
  { ...cohort, attemptNumber: 1, eventName: "evidence_submitted" },
  {
    ...cohort,
    costMicros: 25,
    eventName: "verdict_resolved",
    latencyMilliseconds: 125,
    providerModel: "bounded-operator-review",
    providerVersion: "v1",
    quorumCount: 3,
    reasonCode: "accepted_evidence",
    verdict: "accepted",
  },
  {
    ...cohort,
    eventName: "goal_terminal",
    quorumCount: 3,
    reasonCode: "accepted_evidence",
    terminalState: "completed",
  },
  {
    ...cohort,
    eventKind: "award",
    eventName: "reputation_event_appended",
    points: 15,
    quorumCount: 3,
  },
  { ...cohort, eventName: "next_day_goal_created" },
] as const

describe("analytics event contract", () => {
  it("accepts every versioned V1 event and rejects PII or unknown fields", () => {
    // Given
    const expectedNames = [
      "goal_listed",
      "prediction_exposed",
      "prediction_submitted",
      "prediction_shortage_shown",
      "evidence_submitted",
      "verdict_resolved",
      "goal_terminal",
      "reputation_event_appended",
      "next_day_goal_created",
    ] as const

    // When
    const parsed = eventFixtures.map((event) => analyticsEventSchema.safeParse(event))
    const withPiiValue = eventFixtures.map((event) =>
      analyticsEventSchema.safeParse({ ...event, actorSubjectKey: "adult@example.com" }),
    )
    const withPiiField = eventFixtures.map((event) =>
      analyticsEventSchema.safeParse({ ...event, objectKey: "private/evidence.png" }),
    )
    const withPiiTimezone = eventFixtures.map((event) =>
      analyticsEventSchema.safeParse({ ...event, timezone: "adult@example.com" }),
    )
    const withPiiProviderMetadata = analyticsEventSchema.safeParse({
      ...eventFixtures[5],
      providerModel: "adult@example.com",
    })
    const withUnsupportedVersion = eventFixtures.map((event) =>
      analyticsEventSchema.safeParse({ ...event, eventVersion: 2 }),
    )

    // Then
    expect(analyticsEventNames).toEqual(expectedNames)
    expect(eventFixtures.map(({ eventName }) => eventName)).toEqual(expectedNames)
    expect(parsed.every(({ success }) => success)).toBe(true)
    expect(withPiiValue.every(({ success }) => !success)).toBe(true)
    expect(withPiiField.every(({ success }) => !success)).toBe(true)
    expect(withPiiTimezone.every(({ success }) => !success)).toBe(true)
    expect(withPiiProviderMetadata.success).toBe(false)
    expect(withUnsupportedVersion.every(({ success }) => !success)).toBe(true)
  })

  it("keeps readiness AI and unsupported KPI claims out of shipped runtime sources", async () => {
    // Given
    const shippedFiles: string[] = []
    for await (const path of glob(
      [
        "apps/server/src/**/*.ts",
        "apps/web/**/*.{ts,tsx,json,mjs}",
        "packages/contracts/src/**/*.ts",
        "packages/db/migrations/*.sql",
      ],
      { cwd: process.cwd() },
    )) {
      if (!path.endsWith(".test.ts")) shippedFiles.push(path)
    }

    // When
    const shippedSource = (
      await Promise.all(shippedFiles.map((path) => readFile(path, "utf8")))
    ).join("\n")

    // Then
    expect(shippedSource).not.toMatch(/readiness[_ A-Z-]*(ai|model|probability|shadow)/i)
    expect(shippedSource).not.toMatch(/(?:68|45)\s*%|(?:one|1)[ -]?second|zero[ -]?cost/i)
  })
})
