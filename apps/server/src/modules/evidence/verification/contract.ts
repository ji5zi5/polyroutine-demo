export type OperatorDecision =
  | { readonly verdict: "accepted" }
  | {
      readonly reasonCode: "recipe_mismatch" | "challenge_not_visible" | "notes_insufficient"
      readonly verdict: "rejected"
    }
  | {
      readonly reasonCode: "image_unreadable" | "review_unavailable"
      readonly verdict: "inconclusive"
    }

export type ReviewPolicy = {
  readonly leaseMilliseconds: number
  readonly maxLeaseAttempts: 3
  readonly maxQueueDepth: number
}

export const boundedOperatorReviewPolicy: ReviewPolicy = {
  leaseMilliseconds: 15 * 60 * 1_000,
  maxLeaseAttempts: 3,
  maxQueueDepth: 100,
}
