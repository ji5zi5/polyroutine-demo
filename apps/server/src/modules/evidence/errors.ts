export class EvidenceServiceError extends Error {
  override readonly name = "EvidenceServiceError"

  constructor(
    readonly code:
      | "CHALLENGE_EXPIRED"
      | "CHALLENGE_INVALID"
      | "CHALLENGE_REQUIRED"
      | "EVIDENCE_ATTEMPTS_EXHAUSTED"
      | "EVIDENCE_DEADLINE"
      | "EVIDENCE_NOT_OPEN"
      | "GOAL_NOT_FOUND"
      | "IDEMPOTENCY_CONFLICT"
      | "QUARANTINE_CLEANUP_FAILED"
      | "QUARANTINE_UNAVAILABLE",
    readonly statusCode: 404 | 409 | 503,
  ) {
    super(code)
  }
}
