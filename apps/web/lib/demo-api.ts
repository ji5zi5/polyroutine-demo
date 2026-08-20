import type {
  DailyResult,
  EvidenceChallenge,
  EvidenceStatus,
  Goal,
  PredictionFeed,
  Today,
} from "./contracts"

const DEMO_SUBJECT_KEY = "demo-subject"
const DEMO_GOAL_ID = "f2d5c690-1579-45b3-bd30-a44b5f4c7e2a"
const DEMO_RECEIPT_ID = "34f8e5d4-70ee-469c-b6da-49983fc8c81d"

const demoGoal = {
  evidenceDeadlineAt: "2099-08-20T12:00:00.000Z",
  fields: { noteLineTarget: 5, studyMinutes: 25 },
  id: DEMO_GOAL_ID,
  localGoalDate: "2099-08-20",
  ownerSubjectKey: DEMO_SUBJECT_KEY,
  predictionCutoffAt: "2099-08-20T01:00:00.000Z",
  recipeId: "study_note_photo_v1",
  recipeVersion: 1,
  state: "completed",
} as const satisfies Goal

const demoResult = {
  crowd: { no: 3, yes: 2 },
  effectiveState: "completed",
  goal: demoGoal,
  reputationEvents: [
    {
      eventKey: `goal:${DEMO_GOAL_ID}:completion:v1`,
      kind: "completion",
      points: 10,
    },
    {
      correctedState: "completed",
      eventKey: `goal:${DEMO_GOAL_ID}:correction:1`,
      kind: "correction",
      points: 0,
      reason: "운영 검토 기록을 정정했어요.",
    },
  ],
  reputationTotal: 10,
} as const satisfies DailyResult

const demoToday = { goal: demoGoal, result: demoResult } as const satisfies Today

const demoFeed = {
  cards: [
    {
      anonymousAlias: "익명의 루틴 메이트 1",
      evidenceDeadlineAt: "2099-08-20T12:00:00.000Z",
      goalId: "07ad2bc4-bec9-4a56-a5ea-36d96e20e747",
      predictionCutoffAt: "2099-08-20T01:00:00.000Z",
      recipe: {
        id: "study_note_photo_v1",
        instructions: "수학 오답노트 3문제를 정리해요.",
        version: 1,
      },
    },
    {
      anonymousAlias: "익명의 루틴 메이트 2",
      evidenceDeadlineAt: "2099-08-20T12:00:00.000Z",
      goalId: "b5fb7b54-6de1-4a07-8162-70b9ddf565a8",
      predictionCutoffAt: "2099-08-20T01:00:00.000Z",
      recipe: {
        id: "study_note_photo_v1",
        instructions: "책 15쪽을 읽고 핵심을 3줄로 기록해요.",
        version: 1,
      },
    },
    {
      anonymousAlias: "익명의 루틴 메이트 3",
      evidenceDeadlineAt: "2099-08-20T12:00:00.000Z",
      goalId: "c9aeec42-7775-4240-ad7f-6a6d595cccee",
      predictionCutoffAt: "2099-08-20T01:00:00.000Z",
      recipe: {
        id: "study_note_photo_v1",
        instructions: "강의를 25분 듣고 배운 점을 3줄로 정리해요.",
        version: 1,
      },
    },
  ],
  shortage: {
    nextRefreshAt: "2099-08-20T02:00:00.000Z",
    reason: "eligible_pool_exhausted",
    requested: 5,
    returned: 3,
  },
} as const satisfies PredictionFeed

const demoChallenge = {
  challengeId: "fd785eab-f922-4fd3-87c4-8a07e30b2362",
  claim: "replay_reduction_only",
  code: "PR-DEADBEEF",
  expiresAt: "2099-08-20T00:10:00.000Z",
  instructions: "사진에 코드를 적어 주세요.",
  issuedAt: "2099-08-20T00:00:00.000Z",
} as const satisfies EvidenceChallenge

const demoEvidence = {
  attemptNumber: 1,
  attemptsRemaining: 1,
  canResubmit: false,
  reasonCode: null,
  receiptId: DEMO_RECEIPT_ID,
  state: "accepted",
} as const satisfies EvidenceStatus

type DemoMethod = "DELETE" | "GET" | "PATCH" | "POST"

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

export function demoApiResponse(
  request: Request,
  path: readonly string[],
  method: DemoMethod,
): Response | null {
  if (request.headers.get("x-subject-key") !== DEMO_SUBJECT_KEY) return null
  const route = path.join("/")

  if (method === "GET" && route === "goals/today") return json(demoToday)
  if (method === "GET" && route === "predictions/feed") return json(demoFeed)
  if (method === "GET" && route === `goals/${DEMO_GOAL_ID}/evidence`) {
    return json({ evidence: demoEvidence })
  }
  if (method === "POST" && route === "predictions/exposures") {
    return new Response(null, { status: 204 })
  }
  if (method === "POST" && route === `goals/${DEMO_GOAL_ID}/evidence/challenge`) {
    return json(demoChallenge, 201)
  }
  if (method === "POST" && route === `goals/${DEMO_GOAL_ID}/evidence/presign`) {
    return json({
      expiresAt: "2099-08-20T00:10:00.000Z",
      uploadId: "39b23363-fdb4-4dce-9614-e4ffc6f57d79",
      uploadUrl: new URL("/demo-upload", request.url).toString(),
    })
  }
  if (method === "POST" && route === `goals/${DEMO_GOAL_ID}/evidence/complete`) {
    return json({ receipt_id: DEMO_RECEIPT_ID, state: "pending" }, 202)
  }
  if (method === "DELETE" && route.startsWith(`goals/${DEMO_GOAL_ID}/evidence/uploads/`)) {
    return new Response(null, { status: 204 })
  }
  if (method === "POST" && route.startsWith("predictions/")) {
    return json(
      {
        choice: "yes",
        goalId: route.slice("predictions/".length),
        predictionId: "56599764-1532-46cf-91bf-0cf60715880e",
        submittedAt: "2099-08-20T00:00:00.000Z",
      },
      201,
    )
  }
  return json({ code: "DEMO_ROUTE_NOT_FOUND" }, 404)
}
