import type { GoalState, TerminalGoalState } from "@polyroutine/contracts"
import type { DatabaseHandle } from "@polyroutine/db"

export type SettlementClient = Pick<DatabaseHandle["pool"], "query">

export type CrowdCounts = {
  readonly no: number
  readonly yes: number
}

export type ReputationComponents = {
  readonly completion: number
  readonly crowd: number
}

type GoalRow = {
  readonly owner_subject_key: string
  readonly state: GoalState
}

type TerminalCommand = {
  readonly actor: "operator" | "scheduler"
  readonly client: SettlementClient
  readonly goalId: string
  readonly now: Date
  readonly state: TerminalGoalState
}

export class SettlementConflictError extends Error {
  override readonly name = "SettlementConflictError"

  constructor(readonly code: "GOAL_ALREADY_TERMINAL" | "GOAL_NOT_SETTLEABLE") {
    super(code)
  }
}

function assertNever(value: never): never {
  throw new TypeError(`unexpected state: ${String(value)}`)
}

export function reputationFor(state: TerminalGoalState, crowd: CrowdCounts): ReputationComponents {
  switch (state) {
    case "completed":
      return { completion: 10, crowd: crowd.no > crowd.yes && crowd.no > 0 ? 5 : 0 }
    case "failed":
    case "expired":
    case "cancelled":
      return { completion: 0, crowd: 0 }
    default:
      return assertNever(state)
  }
}

export async function crowdCounts(client: SettlementClient, goalId: string): Promise<CrowdCounts> {
  const result = await client.query<{ readonly no_count: string; readonly yes_count: string }>(
    `select count(*) filter (where choice = 'no')::text as no_count,
       count(*) filter (where choice = 'yes')::text as yes_count
     from predictions where goal_id = $1`,
    [goalId],
  )
  const row = result.rows[0]
  if (row === undefined) throw new TypeError("prediction aggregate returned no row")
  return { no: Number(row.no_count), yes: Number(row.yes_count) }
}

export async function settleTerminalGoal(command: TerminalCommand): Promise<boolean> {
  const result = await command.client.query<GoalRow>(
    "select owner_subject_key, state from goals where id = $1 for update",
    [command.goalId],
  )
  const goal = result.rows[0]
  if (goal === undefined) throw new SettlementConflictError("GOAL_NOT_SETTLEABLE")
  switch (goal.state) {
    case "prediction_open":
      throw new SettlementConflictError("GOAL_NOT_SETTLEABLE")
    case "evidence_open":
      break
    case "completed":
    case "failed":
    case "expired":
    case "cancelled":
      if (goal.state === command.state) return false
      throw new SettlementConflictError("GOAL_ALREADY_TERMINAL")
    default:
      return assertNever(goal.state)
  }

  await command.client.query("update goals set state = $1 where id = $2", [
    command.state,
    command.goalId,
  ])
  const reputation = reputationFor(command.state, await crowdCounts(command.client, command.goalId))
  if (reputation.completion !== 0) {
    await command.client.query(
      `insert into reputation_events(subject_key, business_key, event_kind, points)
       values ($1, $2, 'award', $3)`,
      [goal.owner_subject_key, `goal:${command.goalId}:completion:v1`, reputation.completion],
    )
  }
  if (reputation.crowd !== 0) {
    await command.client.query(
      `insert into reputation_events(subject_key, business_key, event_kind, points)
       values ($1, $2, 'award', $3)`,
      [goal.owner_subject_key, `goal:${command.goalId}:crowd:v1`, reputation.crowd],
    )
  }
  await command.client.query(
    `insert into analytics_events(event_name, business_key, payload, occurred_at)
     values ('goal_terminal', $1, $2::jsonb, $3)`,
    [
      `goal:${command.goalId}:terminal:v1`,
      JSON.stringify({
        actor: command.actor,
        fromState: "evidence_open",
        goalId: command.goalId,
        toState: command.state,
      }),
      command.now,
    ],
  )
  return true
}
