import { createHash, randomUUID } from "node:crypto"
import sharp from "sharp"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { EvidenceHarness, OTHER_OWNER, PNG } from "./evidence-ingest-test-support.js"

const harness = new EvidenceHarness()

describe("evidence-ingest integration", () => {
  beforeAll(async () => harness.start(), 120_000)
  afterAll(async () => harness.stop())
  beforeEach(async () => harness.reset())

  it("returns a pending receipt after quarantining guided evidence and queues review", async () => {
    // Given
    const goalId = await harness.createGoal()
    const code = await harness.challenge(goalId)

    // When
    const response = await harness.upload(goalId, { challengeCode: code })

    // Then
    expect(response).toMatchObject({ statusCode: 202, body: { state: "pending" } })
    expect(response.body.receipt_id).toEqual(expect.any(String))
    expect(harness.store.objects.size).toBe(1)
    const objectEntry = [...harness.store.objects][0]
    if (objectEntry === undefined) throw new TypeError("quarantine object is missing")
    const [objectKey, object] = objectEntry
    expect(objectKey).toBe(`quarantine/${goalId}/${String(response.body.receipt_id)}.png`)
    expect(objectKey).not.toContain("evidence-owner")
    expect(object.contentType).toBe("image/png")
    const quarantinedHash = createHash("sha256").update(object.bytes).digest("hex")
    const persisted = await harness.requireDatabase().pool.query(
      `select e.state, e.attempt_number, u.object_key, u.content_type, u.width, u.height, u.sha256,
         u.exif_stripped, u.challenge_id is not null as has_challenge,
         j.state as job_state, m.state as moderation_state, c.consumed_at is not null as consumed,
         c.signal_kind
       from evidences e join evidence_uploads u on u.evidence_id = e.id
       join verification_jobs j on j.evidence_id = e.id
       join moderation_cases m on m.evidence_id = e.id
       join evidence_challenges c on c.id = u.challenge_id`,
    )
    expect(persisted.rows).toEqual([
      expect.objectContaining({
        attempt_number: 1,
        consumed: true,
        content_type: "image/png",
        exif_stripped: true,
        has_challenge: true,
        height: 1,
        job_state: "queued",
        moderation_state: "quarantined",
        sha256: quarantinedHash,
        signal_kind: "replay_reduction_only",
        state: "pending",
        width: 1,
      }),
    ])
    expect(
      await harness
        .requireDatabase()
        .pool.query(
          "select event_name from analytics_events where business_key like 'evidence:%:received'",
        ),
    ).toMatchObject({ rows: [{ event_name: "evidence_received" }] })
    expect(harness.verifierCalls).toBe(0)
  })

  it("rejects an executable disguised as PNG without persisting it", async () => {
    // Given
    const goalId = await harness.createGoal()
    const code = await harness.challenge(goalId)

    // When
    const response = await harness.upload(goalId, {
      body: Buffer.from("MZ executable"),
      challengeCode: code,
    })

    // Then
    expect(response).toMatchObject({ statusCode: 415, body: { code: "IMAGE_TYPE_MISMATCH" } })
    expect(harness.store.objects.size).toBe(0)
    expect((await harness.requireDatabase().pool.query("select id from evidences")).rowCount).toBe(
      0,
    )
  })

  it("rejects uploads larger than eight MiB at the HTTP boundary", async () => {
    // Given
    const goalId = await harness.createGoal()

    // When
    const response = await harness.upload(goalId, {
      body: Buffer.alloc(8 * 1024 * 1024 + 1),
    })

    // Then
    expect(response).toMatchObject({ statusCode: 413, body: { code: "IMAGE_TOO_LARGE" } })
    expect(harness.store.objects.size).toBe(0)
  })

  it("rejects image dimensions that exceed decoder limits", async () => {
    // Given
    const goalId = await harness.createGoal()
    const bomb = Buffer.from(PNG)
    bomb.writeUInt32BE(100_000, 16)
    bomb.writeUInt32BE(100_000, 20)

    // When
    const response = await harness.upload(goalId, { body: bomb })

    // Then
    expect(response).toMatchObject({ statusCode: 422, body: { code: "IMAGE_LIMIT_EXCEEDED" } })
    expect(harness.store.objects.size).toBe(0)
  })

  it("records a duplicate hash signal while retaining each guided challenge receipt", async () => {
    // Given
    const firstGoalId = await harness.createGoal()
    const firstCode = await harness.challenge(firstGoalId)
    const secondGoalId = await harness.createGoal({ owner: OTHER_OWNER })
    const secondCode = await harness.challenge(secondGoalId, OTHER_OWNER)

    // When
    const first = await harness.upload(firstGoalId, { challengeCode: firstCode })
    const second = await harness.upload(secondGoalId, {
      challengeCode: secondCode,
      owner: OTHER_OWNER,
    })

    // Then
    expect([first.statusCode, second.statusCode]).toEqual([202, 202])
    const signals = await harness
      .requireDatabase()
      .pool.query(
        "select duplicate_signal, challenge_id is not null as has_challenge from evidence_uploads order by created_at",
      )
    expect(signals.rows).toEqual([
      { duplicate_signal: false, has_challenge: true },
      { duplicate_signal: true, has_challenge: true },
    ])
  })

  it("replays one pending receipt idempotently and rejects changed bytes", async () => {
    // Given
    const goalId = await harness.createGoal()
    const code = await harness.challenge(goalId)
    const idempotencyKey = "guided-upload-1"
    const changedImage = await sharp({
      create: { background: "black", channels: 3, height: 2, width: 2 },
    })
      .jpeg()
      .toBuffer()

    // When
    const first = await harness.upload(goalId, { challengeCode: code, idempotencyKey })
    harness.now = new Date(harness.now.getTime() + 2 * 60 * 60 * 1_000)
    const replay = await harness.upload(goalId, { challengeCode: code, idempotencyKey })
    const conflict = await harness.upload(goalId, {
      body: changedImage,
      challengeCode: code,
      contentType: "image/jpeg",
      idempotencyKey,
    })

    // Then
    expect(first).toMatchObject({ statusCode: 202, body: { state: "pending" } })
    expect(replay).toEqual(first)
    expect(conflict).toMatchObject({
      statusCode: 409,
      body: { code: "IDEMPOTENCY_CONFLICT" },
    })
    expect(harness.store.objects.size).toBe(1)
    expect((await harness.requireDatabase().pool.query("select id from evidences")).rowCount).toBe(
      1,
    )
    expect(
      (await harness.requireDatabase().pool.query("select id from verification_jobs")).rowCount,
    ).toBe(1)
  })

  it("rejects an expired guided challenge without consuming it", async () => {
    // Given
    const goalId = await harness.createGoal()
    const code = await harness.challenge(goalId)
    harness.now = new Date(harness.now.getTime() + 10 * 60 * 1_000 + 1)

    // When
    const response = await harness.upload(goalId, { challengeCode: code })

    // Then
    expect(response).toMatchObject({ statusCode: 409, body: { code: "CHALLENGE_EXPIRED" } })
    expect(harness.store.objects.size).toBe(0)
    expect(
      await harness.requireDatabase().pool.query("select consumed_at from evidence_challenges"),
    ).toMatchObject({ rows: [{ consumed_at: null }] })
  })

  it("requires the selected guided challenge and cannot reuse a consumed code", async () => {
    // Given
    const goalId = await harness.createGoal()
    const code = await harness.challenge(goalId)

    // When
    const missing = await harness.upload(goalId)
    const accepted = await harness.upload(goalId, { challengeCode: code })
    const reused = await harness.upload(goalId, { challengeCode: code })

    // Then
    expect(missing).toMatchObject({ statusCode: 409, body: { code: "CHALLENGE_REQUIRED" } })
    expect(accepted.statusCode).toBe(202)
    expect(reused).toMatchObject({ statusCode: 409, body: { code: "CHALLENGE_INVALID" } })
    expect(harness.store.objects.size).toBe(1)
  })

  it("rejects another owner's goal before storing bytes", async () => {
    // Given
    const goalId = await harness.createGoal({ owner: OTHER_OWNER })

    // When
    const response = await harness.upload(goalId)

    // Then
    expect(response).toMatchObject({ statusCode: 404, body: { code: "GOAL_NOT_FOUND" } })
    expect(harness.store.objects.size).toBe(0)
  })

  it("rejects late and third uploads before storing bytes", async () => {
    // Given
    const lateGoalId = await harness.createGoal({ deadline: new Date(harness.now.getTime() - 1) })
    harness.now = new Date("2026-08-20T01:00:00.000Z")
    const exhaustedGoalId = await harness.createGoal()
    await harness.requireDatabase().pool.query(
      `insert into evidences(goal_id, owner_subject_key, attempt_number, business_key, state)
       values ($1, $2, 1, $3, 'rejected'), ($1, $2, 2, $4, 'rejected')`,
      [exhaustedGoalId, "evidence-owner", randomUUID(), randomUUID()],
    )

    // When
    const late = await harness.upload(lateGoalId)
    const third = await harness.upload(exhaustedGoalId)

    // Then
    expect(late).toMatchObject({ statusCode: 409, body: { code: "EVIDENCE_DEADLINE" } })
    expect(third).toMatchObject({
      statusCode: 409,
      body: { code: "EVIDENCE_ATTEMPTS_EXHAUSTED" },
    })
    expect(harness.store.objects.size).toBe(0)
  })

  it("deletes quarantined bytes when persistence fails after object storage", async () => {
    // Given
    const goalId = await harness.createGoal()
    const code = await harness.challenge(goalId)
    const evidenceId = randomUUID()
    harness.uuidValues.push(evidenceId)
    await harness.requireDatabase().pool.query(
      `insert into analytics_events(event_name, business_key, payload)
       values ('collision_fixture', $1, '{}')`,
      [`evidence:${evidenceId}:received`],
    )

    // When
    const response = await harness.upload(goalId, { challengeCode: code })

    // Then
    expect(response.statusCode).toBe(500)
    expect(harness.store.objects.size).toBe(0)
    const database = harness.requireDatabase()
    expect((await database.pool.query("select id from evidences")).rowCount).toBe(0)
    expect((await database.pool.query("select id from verification_jobs")).rowCount).toBe(0)
    expect(await database.pool.query("select consumed_at from evidence_challenges")).toMatchObject({
      rows: [{ consumed_at: null }],
    })
  })

  it("rolls back all metadata when quarantine storage fails", async () => {
    // Given
    const goalId = await harness.createGoal()
    const code = await harness.challenge(goalId)
    harness.store.failPut = true

    // When
    const response = await harness.upload(goalId, { challengeCode: code })

    // Then
    expect(response).toMatchObject({ statusCode: 503, body: { code: "QUARANTINE_UNAVAILABLE" } })
    expect(harness.store.objects.size).toBe(0)
    const database = harness.requireDatabase()
    expect((await database.pool.query("select id from evidences")).rowCount).toBe(0)
    expect(
      (
        await database.pool.query(
          "select id from analytics_events where business_key like 'evidence:%:received'",
        )
      ).rowCount,
    ).toBe(0)
    expect((await database.pool.query("select id from verification_jobs")).rowCount).toBe(0)
    expect(await database.pool.query("select consumed_at from evidence_challenges")).toMatchObject({
      rows: [{ consumed_at: null }],
    })
  })
})
