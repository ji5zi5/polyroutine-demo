import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import type { EvidenceObject, EvidenceObjectKey, EvidenceObjectStore } from "@polyroutine/contracts"

export type EvidenceStoreSettings = {
  readonly accessKeyId: string
  readonly bucket: string
  readonly endpoint: string
  readonly region: string
  readonly secretAccessKey: string
}

export class S3EvidenceObjectStore implements EvidenceObjectStore {
  readonly #bucket: string
  readonly #client: S3Client

  constructor(settings: EvidenceStoreSettings) {
    this.#bucket = settings.bucket
    this.#client = new S3Client({
      credentials: {
        accessKeyId: settings.accessKeyId,
        secretAccessKey: settings.secretAccessKey,
      },
      endpoint: settings.endpoint,
      forcePathStyle: true,
      region: settings.region,
    })
  }

  async delete(key: EvidenceObjectKey): Promise<void> {
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }))
  }

  async put(object: EvidenceObject): Promise<void> {
    await this.#client.send(
      new PutObjectCommand({
        Body: object.bytes,
        Bucket: this.#bucket,
        ContentType: object.contentType,
        Key: object.key,
      }),
    )
  }
}
