import { argon2, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

const ARGON_MEMORY_KIB = 19_456
const ARGON_PARALLELISM = 1
const ARGON_PASSES = 2
const ARGON_TAG_LENGTH = 32

function deriveArgon2id(password: string, nonce: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      {
        memory: ARGON_MEMORY_KIB,
        message: password,
        nonce,
        parallelism: ARGON_PARALLELISM,
        passes: ARGON_PASSES,
        tagLength: ARGON_TAG_LENGTH,
      },
      (error, result) => {
        if (error !== null) {
          reject(error)
          return
        }
        resolve(result)
      },
    )
  })
}

export class Argon2idPasswordHasher {
  async hash(password: string): Promise<string> {
    const nonce = randomBytes(16)
    const tag = await deriveArgon2id(password, nonce)
    return `$argon2id$v=19$m=${ARGON_MEMORY_KIB},t=${ARGON_PASSES},p=${ARGON_PARALLELISM}$${nonce.toString("base64url")}$${tag.toString("base64url")}`
  }

  async verify(encoded: string, password: string): Promise<boolean> {
    const match = /^\$argon2id\$v=19\$m=19456,t=2,p=1\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(
      encoded,
    )
    const nonceText = match?.[1]
    const expectedText = match?.[2]
    if (nonceText === undefined || expectedText === undefined) return false
    const expected = Buffer.from(expectedText, "base64url")
    if (expected.byteLength !== ARGON_TAG_LENGTH) return false
    const actual = await deriveArgon2id(password, Buffer.from(nonceText, "base64url"))
    return timingSafeEqual(actual, expected)
  }
}

export type IssuedSecret = {
  readonly hash: string
  readonly value: string
}

export class OpaqueSecretCodec {
  constructor(private readonly secret: string) {}

  issue(): IssuedSecret {
    const value = randomBytes(32).toString("base64url")
    return { hash: this.hash(value), value }
  }

  hash(value: string): string {
    return createHmac("sha256", this.secret).update(value).digest("hex")
  }

  matches(value: string, expectedHash: string): boolean {
    if (!/^[a-f0-9]{64}$/.test(expectedHash)) return false
    return timingSafeEqual(Buffer.from(this.hash(value), "hex"), Buffer.from(expectedHash, "hex"))
  }
}
