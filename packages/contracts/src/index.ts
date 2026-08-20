export * from "./domain/index.js"
export * from "./evidence/recipe-v1.js"

declare const evidenceObjectKeyBrand: unique symbol

export type EvidenceObjectKey = string & {
  readonly [evidenceObjectKeyBrand]: "EvidenceObjectKey"
}

export type EvidenceObject = {
  readonly bytes: Uint8Array
  readonly contentType: string
  readonly key: EvidenceObjectKey
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
