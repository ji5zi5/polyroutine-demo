import type { Clock, UuidFactory } from "@polyroutine/contracts"
import type { DatabaseHandle } from "@polyroutine/db"
import { boundedOperatorReviewPolicy, type ReviewPolicy } from "./contract.js"
import { VerificationServiceError } from "./errors.js"
import { claimReview, promoteQueuedJobs, promoteVerificationJob } from "./queue.js"
import type { VerificationDependencies } from "./records.js"
import { decideReview } from "./verdict.js"

type VerificationServiceOptions = {
  readonly clock: Clock
  readonly database: DatabaseHandle
  readonly policy?: ReviewPolicy
  readonly uuid: UuidFactory
}

export function createVerificationService(options: VerificationServiceOptions) {
  const dependencies: VerificationDependencies = {
    clock: options.clock,
    database: options.database,
    policy: options.policy ?? boundedOperatorReviewPolicy,
    uuid: options.uuid,
  }
  return {
    claim: (operatorSubjectKey: string) => claimReview(dependencies, operatorSubjectKey),
    decide: (command: Parameters<typeof decideReview>[1]) => decideReview(dependencies, command),
    promoteJob: (verificationJobId: string) =>
      promoteVerificationJob(dependencies, verificationJobId),
    promoteQueuedJobs: () => promoteQueuedJobs(dependencies),
  }
}

export { VerificationServiceError }
export type VerificationService = ReturnType<typeof createVerificationService>
