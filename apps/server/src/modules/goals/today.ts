import type { TerminalGoalState } from "@polyroutine/contracts"
import type { DatabaseHandle } from "@polyroutine/db"
import type {
  DailyResultView,
  ReputationEventView,
  TodayView,
} from "./contract.js"
import { type GoalRow, toGoalView } from "./records.js"

const goalSelection = `select id::text, owner_subject_key, local_goal_date::text, recipe_id,
  recipe_version, goal_copy, prediction_cutoff_at, evidence_deadline_at, state from goals`

type AwardRow = {
  readonly completion: number
  readonly crowd: number
}

type CorrectionRow = {
  readonly business_key: string
  readonly corrected_state: TerminalGoalState
  readonly points: number
  readonly reason: string
}

type CrowdRow = {
  readonly no_count: number
  readonly yes_count: number
}

function storedTerminalState(state: GoalRow["state"]): TerminalGoalState {
  switch (state) {
    case "completed":
    case "failed":
    case "expired":
    case "cancelled":
      return state
    case "prediction_open":
    case "evidence_open":
      throw new TypeError(`result projection received nonterminal state: ${state}`)
    default: {
      const exhaustive: never = state
      throw new TypeError(`unexpected goal state: ${String(exhaustive)}`)
    }
  }
}

export async function readTodayView(
  database: DatabaseHandle,
  subjectKey: string,
  localGoalDate: string,
): Promise<TodayView> {
  const client = await database.pool.connect()
  await client.query("begin transaction isolation level repeatable read read only")
  try {
    const current = await client.query<GoalRow>(
      `${goalSelection} where owner_subject_key = $1 and local_goal_date = $2`,
      [subjectKey, localGoalDate],
    )
    const terminal = await client.query<GoalRow>(
      `${goalSelection}
       where owner_subject_key = $1 and local_goal_date <= $2
         and state in ('completed', 'failed', 'expired', 'cancelled')
       order by local_goal_date desc limit 1`,
      [subjectKey, localGoalDate],
    )
    const goal = current.rows[0] === undefined ? null : toGoalView(current.rows[0])
    const terminalGoal = terminal.rows[0]
    if (terminalGoal === undefined) {
      await client.query("commit")
      return { goal, result: null }
    }

    const crowd = await client.query<CrowdRow>(
      `select count(*) filter (where choice = 'no')::integer as no_count,
         count(*) filter (where choice = 'yes')::integer as yes_count
       from predictions where goal_id = $1`,
      [terminalGoal.id],
    )
    const awards = await client.query<AwardRow>(
      `select
         coalesce(sum(points) filter (where business_key = $2), 0)::integer as completion,
         coalesce(sum(points) filter (where business_key = $3), 0)::integer as crowd
       from reputation_events where subject_key = $1`,
      [
        subjectKey,
        `goal:${terminalGoal.id}:completion:v1`,
        `goal:${terminalGoal.id}:crowd:v1`,
      ],
    )
    const corrections = await client.query<CorrectionRow>(
      `select c.business_key, c.corrected_state, c.reason,
         coalesce(sum(r.points), 0)::integer as points
       from goal_correction_events c
       left join reputation_events r
         on left(r.business_key, length(c.business_key) + 1) = c.business_key || ':'
       where c.goal_id = $1
       group by c.sequence_number, c.business_key, c.corrected_state, c.reason
       order by c.sequence_number`,
      [terminalGoal.id],
    )
    const award = awards.rows[0]
    const counts = crowd.rows[0]
    if (award === undefined || counts === undefined) {
      throw new TypeError("daily result aggregate returned no row")
    }
    const awardEvents: readonly ReputationEventView[] = [
      ...(award.completion === 0
        ? []
        : [
            {
              eventKey: `goal:${terminalGoal.id}:completion:v1`,
              kind: "completion" as const,
              points: award.completion,
            },
          ]),
      ...(award.crowd === 0
        ? []
        : [
            {
              eventKey: `goal:${terminalGoal.id}:crowd:v1`,
              kind: "crowd" as const,
              points: award.crowd,
            },
          ]),
    ]
    const correctionEvents: readonly ReputationEventView[] = corrections.rows.map(
      ({ business_key, corrected_state, points, reason }) => ({
        correctedState: corrected_state,
        eventKey: business_key,
        kind: "correction" as const,
        points,
        reason,
      }),
    )
    const reputationEvents = [...awardEvents, ...correctionEvents]
    const latestCorrection = corrections.rows.at(-1)
    const result: DailyResultView = {
      crowd: { no: counts.no_count, yes: counts.yes_count },
      effectiveState:
        latestCorrection?.corrected_state ?? storedTerminalState(terminalGoal.state),
      goal: toGoalView(terminalGoal),
      reputationEvents,
      reputationTotal: reputationEvents.reduce((total, event) => total + event.points, 0),
    }
    await client.query("commit")
    return { goal, result }
  } catch (error) {
    await client.query("rollback")
    throw error
  } finally {
    client.release()
  }
}
