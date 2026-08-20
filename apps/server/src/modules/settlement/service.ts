import type { Clock, GoalState, TerminalGoalState } from "@polyroutine/contracts"
import type { DatabaseHandle } from "@polyroutine/db"
import { crowdCounts, reputationFor, type SettlementClient } from "./reputation.js"

type SettlementServiceOptions = {
  readonly clock: Clock
  readonly database: DatabaseHandle
}

export type CorrectionCommand = {
  readonly correctedState: TerminalGoalState
  readonly goalId: string
  readonly idempotencyKey: string
  readonly operatorSubjectKey: string
  readonly reason: string
}

type GoalRow = {
  readonly owner_subject_key: string
  readonly state: GoalState
}

type CorrectionRow = {
  readonly corrected_state: TerminalGoalState
  readonly operator_subject_key: string
  readonly reason: string
}

type CorrectionDelta = {
  readonly businessKey: string
  readonly client: SettlementClient
  readonly points: number
  readonly reason: string
  readonly referenceBusinessKey: string
  readonly subjectKey: string
}

export class CorrectionServiceError extends Error {
  override readonly name = "CorrectionServiceError"

  constructor(
    readonly code: "CORRECTION_CONFLICT" | "GOAL_NOT_FOUND" | "TERMINAL_REQUIRED",
    readonly statusCode: 404 | 409,
  ) {
    super(code)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`unexpected goal state: ${String(value)}`)
}

function storedTerminalState(state: GoalState): TerminalGoalState {
  switch (state) {
    case "completed":
    case "failed":
    case "expired":
    case "cancelled":
      return state
    case "prediction_open":
    case "evidence_open":
      throw new CorrectionServiceError("TERMINAL_REQUIRED", 409)
    default:
      return assertNever(state)
  }
}

async function effectiveState(
  client: SettlementClient,
  goalId: string,
  storedState: TerminalGoalState,
): Promise<TerminalGoalState> {
  const latest = await client.query<{ readonly corrected_state: TerminalGoalState }>(
    `select corrected_state from goal_correction_events
     where goal_id = $1 order by sequence_number desc limit 1`,
    [goalId],
  )
  return latest.rows[0]?.corrected_state ?? storedState
}

async function appendDelta(delta: CorrectionDelta): Promise<void> {
  if (delta.points === 0) return
  await delta.client.query(
    `insert into reputation_events(
       subject_key, business_key, event_kind, points, reference_business_key, reason
     ) values ($1, $2, 'correction', $3, $4, $5)`,
    [delta.subjectKey, delta.businessKey, delta.points, delta.referenceBusinessKey, delta.reason],
  )
}

async function reputationTotal(client: SettlementClient, subjectKey: string): Promise<number> {
  const result = await client.query<{ readonly total: string }>(
    "select coalesce(sum(points), 0)::text as total from reputation_events where subject_key = $1",
    [subjectKey],
  )
  return Number(result.rows[0]?.total ?? "0")
}

export function createSettlementService(options: SettlementServiceOptions) {
  return {
    correct: async (command: CorrectionCommand) => {
      const now = options.clock.now()
      const businessKey = `goal:${command.goalId}:correction:${command.idempotencyKey}`
      const client = await options.database.pool.connect()
      await client.query("begin")
      try {
        const goalResult = await client.query<GoalRow>(
          "select owner_subject_key, state from goals where id = $1 for update",
          [command.goalId],
        )
        const goal = goalResult.rows[0]
        if (goal === undefined) throw new CorrectionServiceError("GOAL_NOT_FOUND", 404)
        const storedState = storedTerminalState(goal.state)
        const replay = await client.query<CorrectionRow>(
          `select operator_subject_key, corrected_state, reason
           from goal_correction_events where business_key = $1`,
          [businessKey],
        )
        const prior = replay.rows[0]
        if (prior !== undefined) {
          if (
            prior.operator_subject_key !== command.operatorSubjectKey ||
            prior.corrected_state !== command.correctedState ||
            prior.reason !== command.reason
          ) {
            throw new CorrectionServiceError("CORRECTION_CONFLICT", 409)
          }
          const total = await reputationTotal(client, goal.owner_subject_key)
          await client.query("commit")
          return {
            correctedState: prior.corrected_state,
            replayed: true as const,
            reputation: total,
          }
        }

        const previousState = await effectiveState(client, command.goalId, storedState)
        const crowd = await crowdCounts(client, command.goalId)
        const previous = reputationFor(previousState, crowd)
        const corrected = reputationFor(command.correctedState, crowd)
        await client.query(
          `insert into goal_correction_events(
             goal_id, operator_subject_key, corrected_state, reason, business_key
           ) values ($1, $2, $3, $4, $5)`,
          [
            command.goalId,
            command.operatorSubjectKey,
            command.correctedState,
            command.reason,
            businessKey,
          ],
        )
        await appendDelta({
          businessKey: `${businessKey}:completion:v1`,
          client,
          points: corrected.completion - previous.completion,
          reason: command.reason,
          referenceBusinessKey: `goal:${command.goalId}:completion:v1`,
          subjectKey: goal.owner_subject_key,
        })
        await appendDelta({
          businessKey: `${businessKey}:crowd:v1`,
          client,
          points: corrected.crowd - previous.crowd,
          reason: command.reason,
          referenceBusinessKey: `goal:${command.goalId}:crowd:v1`,
          subjectKey: goal.owner_subject_key,
        })
        await client.query(
          `insert into analytics_events(event_name, business_key, payload, occurred_at)
           values ('goal_corrected', $1, $2::jsonb, $3)`,
          [
            `${businessKey}:event:v1`,
            JSON.stringify({
              correctedState: command.correctedState,
              goalId: command.goalId,
              previousState,
            }),
            now,
          ],
        )
        const total = await reputationTotal(client, goal.owner_subject_key)
        await client.query("commit")
        return {
          correctedState: command.correctedState,
          replayed: false as const,
          reputation: total,
        }
      } catch (error) {
        await client.query("rollback")
        throw error
      } finally {
        client.release()
      }
    },
  }
}

export type SettlementService = ReturnType<typeof createSettlementService>
