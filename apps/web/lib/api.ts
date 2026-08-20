import ky, { NetworkError, TimeoutError } from "ky"
import type { ZodType } from "zod"
import {
  type Account,
  accountSchema,
  apiErrorSchema,
  type EvidenceChallenge,
  type EvidenceReceipt,
  type EvidenceStatus,
  evidenceChallengeSchema,
  evidenceReceiptSchema,
  evidenceStatusResponseSchema,
  type Goal,
  goalSchema,
  type PredictionFeed,
  predictionFeedSchema,
  predictionSchema,
  todayResponseSchema,
} from "./contracts"

const REQUEST_TIMEOUT_MILLISECONDS = 10_000
const http = ky.create({ retry: 0, throwHttpErrors: false, timeout: REQUEST_TIMEOUT_MILLISECONDS })

export class ApiClientError extends Error {
  override readonly name = "ApiClientError"

  constructor(
    readonly status: number,
    readonly code: string | undefined,
    readonly replacement: boolean,
  ) {
    super(code ?? `HTTP_${status}`)
  }
}

export class ApiAbortError extends Error {
  override readonly name = "ApiAbortError"

  constructor(cause: DOMException) {
    super("The upload was cancelled before its receipt was confirmed", { cause })
  }
}

export class ApiNetworkError extends Error {
  override readonly name = "ApiNetworkError"

  constructor(cause: NetworkError | TimeoutError | TypeError) {
    super("The server response could not be confirmed", { cause })
  }
}

async function responseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  return text === "" ? null : JSON.parse(text)
}

async function responseFrom(request: Promise<Response>): Promise<Response> {
  try {
    return await request
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiAbortError(error)
    }
    if (
      error instanceof NetworkError ||
      error instanceof TimeoutError ||
      error instanceof TypeError
    ) {
      throw new ApiNetworkError(error)
    }
    throw error
  }
}

async function parseResponse<T>(request: Promise<Response>, schema: ZodType<T>): Promise<T> {
  const response = await responseFrom(request)
  const body = await responseBody(response)
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(body)
    throw new ApiClientError(
      response.status,
      error.success ? (error.data.code ?? error.data.error) : undefined,
      error.success ? (error.data.replacement ?? false) : false,
    )
  }
  return schema.parse(body)
}

async function ensureSuccess(request: Promise<Response>): Promise<void> {
  const response = await responseFrom(request)
  const body = await responseBody(response)
  if (response.ok) return
  const error = apiErrorSchema.safeParse(body)
  throw new ApiClientError(
    response.status,
    error.success ? (error.data.code ?? error.data.error) : undefined,
    error.success ? (error.data.replacement ?? false) : false,
  )
}

function accountHeaders(account: Account): Readonly<Record<string, string>> {
  return {
    authorization: `Bearer ${account.session.token}`,
    "x-csrf-token": account.session.csrfToken,
  }
}

export async function signup(input: {
  readonly adultSelfAttested: true
  readonly email: string
  readonly password: string
  readonly privacyVersion: string
  readonly termsVersion: string
  readonly timezone: string
}): Promise<Account> {
  return parseResponse(http.post("v1/accounts/signup", { json: input }), accountSchema)
}

export async function login(input: {
  readonly email: string
  readonly password: string
}): Promise<Account> {
  return parseResponse(http.post("v1/accounts/login", { json: input }), accountSchema)
}

export async function logout(account: Account): Promise<void> {
  await ensureSuccess(http.post("v1/accounts/logout", { headers: accountHeaders(account) }))
}

export async function getToday(subjectKey: string): Promise<Goal | null> {
  const result = await parseResponse(
    http.get("v1/goals/today", { headers: { "x-subject-key": subjectKey } }),
    todayResponseSchema,
  )
  return result.goal
}

export async function createGoal(subjectKey: string, noteLineTarget: number): Promise<Goal> {
  return parseResponse(
    http.post("v1/goals", {
      headers: { "x-subject-key": subjectKey },
      json: { noteLineTarget, studyMinutes: 25 },
    }),
    goalSchema,
  )
}

export async function getPredictionFeed(subjectKey: string): Promise<PredictionFeed> {
  return parseResponse(
    http.get("v1/predictions/feed", { headers: { "x-subject-key": subjectKey } }),
    predictionFeedSchema,
  )
}

export async function exposeCard(
  subjectKey: string,
  goalId: string,
  idempotencyKey: string,
): Promise<void> {
  await ensureSuccess(
    http.post("v1/predictions/exposures", {
      headers: { "idempotency-key": idempotencyKey, "x-subject-key": subjectKey },
      json: { goalId },
    }),
  )
}

export async function requestEvidenceChallenge(
  subjectKey: string,
  goalId: string,
): Promise<EvidenceChallenge> {
  return parseResponse(
    http.post(`v1/goals/${goalId}/evidence/challenge`, {
      headers: { "x-subject-key": subjectKey },
    }),
    evidenceChallengeSchema,
  )
}

export async function getEvidenceStatus(
  subjectKey: string,
  goalId: string,
): Promise<EvidenceStatus | null> {
  const response = await parseResponse(
    http.get(`v1/goals/${goalId}/evidence`, {
      headers: { "x-subject-key": subjectKey },
    }),
    evidenceStatusResponseSchema,
  )
  return response.evidence
}

type EvidenceUploadRequest = {
  readonly challengeCode: string
  readonly file: File
  readonly goalId: string
  readonly idempotencyKey: string
  readonly subjectKey: string
}

export async function uploadEvidence(
  input: EvidenceUploadRequest,
  signal: AbortSignal,
): Promise<EvidenceReceipt> {
  const bytes = await input.file.arrayBuffer()
  return parseResponse(
    http.post(`v1/goals/${input.goalId}/evidence`, {
      body: bytes,
      headers: {
        "content-type": input.file.type,
        "idempotency-key": input.idempotencyKey,
        "x-evidence-challenge": input.challengeCode,
        "x-subject-key": input.subjectKey,
      },
      signal,
    }),
    evidenceReceiptSchema,
  )
}

export async function submitPrediction(input: {
  readonly choice: "no" | "yes"
  readonly goalId: string
  readonly idempotencyKey: string
  readonly subjectKey: string
}): Promise<void> {
  await parseResponse(
    http.post(`v1/predictions/${input.goalId}`, {
      headers: {
        "idempotency-key": input.idempotencyKey,
        "x-subject-key": input.subjectKey,
      },
      json: { choice: input.choice },
    }),
    predictionSchema,
  )
}
