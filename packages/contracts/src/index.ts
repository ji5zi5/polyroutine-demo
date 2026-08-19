export * from "./domain/index.js"

declare const evidenceObjectKeyBrand: unique symbol

export type EvidenceObjectKey = string & {
  readonly [evidenceObjectKeyBrand]: "EvidenceObjectKey"
}

export type EvidenceObject = {
  readonly bytes: Uint8Array
  readonly contentType: string
  readonly key: EvidenceObjectKey
}

export type EvidenceReviewRequest = {
  readonly key: EvidenceObjectKey
  readonly recipe: "study_note_photo_v1"
  readonly recipeVersion: 1
}

export type EvidenceReviewResult = {
  readonly kind: "operator_review_required"
}

export interface Clock {
  now(): Date
}

export interface UuidFactory {
  create(): string
}

export interface EvidenceObjectStore {
  delete(key: EvidenceObjectKey): Promise<void>
  put(object: EvidenceObject): Promise<void>
}

export interface EvidenceVerifier {
  review(request: EvidenceReviewRequest): Promise<EvidenceReviewResult>
}
