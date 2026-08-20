export class VerificationServiceError extends Error {
  override readonly name = "VerificationServiceError"

  constructor(
    readonly code:
      | "GOAL_ALREADY_TERMINAL"
      | "OPERATOR_QUEUE_SATURATED"
      | "REVIEW_LEASE_STALE"
      | "REVIEW_NOT_FOUND"
      | "VERDICT_CONFLICT"
      | "VERIFICATION_JOB_NOT_FOUND",
    readonly statusCode: 404 | 409 | 503,
  ) {
    super(code)
  }
}
