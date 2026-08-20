import type { EvidenceObject, EvidenceObjectKey, EvidenceObjectStore } from "@polyroutine/contracts"

export class ObjectStoreContractError extends Error {
  override readonly name = "ObjectStoreContractError"

  constructor(readonly operation: "delete" | "put") {
    super(`object ${operation} unavailable`)
  }
}

/** Mutable failure-semantic fake for object-store boundary tests. */
export class ContractEvidenceObjectStore implements EvidenceObjectStore {
  failDelete = false
  failPut = false
  readonly objects = new Map<EvidenceObjectKey, EvidenceObject>()
  readonly signedUrls = new Map<string, Date>()

  async delete(key: EvidenceObjectKey): Promise<void> {
    if (this.failDelete) throw new ObjectStoreContractError("delete")
    this.objects.delete(key)
  }

  isSignedUrlValid(url: string, now: Date): boolean {
    const expiresAt = this.signedUrls.get(url)
    return expiresAt !== undefined && now < expiresAt
  }

  async signRead(key: EvidenceObjectKey, expiresAt: Date): Promise<string> {
    const url = `https://objects.test/signed/${encodeURIComponent(key)}?expires=${expiresAt.getTime()}`
    this.signedUrls.set(url, new Date(expiresAt))
    return url
  }

  async put(object: EvidenceObject): Promise<void> {
    if (this.failPut) throw new ObjectStoreContractError("put")
    this.objects.set(object.key, { ...object, bytes: object.bytes.slice() })
  }
}
