import { ZodError, z } from "zod"
import { type Goal, goalSchema } from "./contracts"

const MAX_CACHED_GOALS = 7
const cachedGoalsSchema = z.array(goalSchema).max(MAX_CACHED_GOALS)

function cacheKey(subjectKey: string): string {
  return `poly-routine-goals:v1:${encodeURIComponent(subjectKey)}`
}

export function getCachedGoals(subjectKey: string): readonly Goal[] {
  const value = localStorage.getItem(cacheKey(subjectKey))
  if (value === null) return []
  try {
    return cachedGoalsSchema.parse(JSON.parse(value))
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof ZodError) return []
    throw error
  }
}

export function rememberGoal(subjectKey: string, goal: Goal): void {
  const goals = getCachedGoals(subjectKey)
  const next = [goal, ...goals.filter(({ id }) => id !== goal.id)]
    .sort((left, right) => right.localGoalDate.localeCompare(left.localGoalDate))
    .slice(0, MAX_CACHED_GOALS)
  localStorage.setItem(cacheKey(subjectKey), JSON.stringify(next))
}
