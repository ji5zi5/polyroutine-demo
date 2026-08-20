import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import type {
  EvidenceBrowserUploadStore,
  EvidenceObject,
  EvidenceObjectKey,
  EvidenceObjectStore,
  EvidenceUploadTarget,
} from "@polyroutine/contracts"
import type { EvidenceUrlSigner } from "./modules/moderation/service.js"

export type EvidenceStoreSettings = {
  readonly accessKeyId: string
  readonly bucket: string
  readonly endpoint: string
  readonly region: string
  readonly secretAccessKey: string
}

export class S3EvidenceObjectStore
  implements EvidenceObjectStore, EvidenceBrowserUploadStore, EvidenceUrlSigner
{
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

  async get(key: EvidenceObjectKey): Promise<EvidenceObject | null> {
    try {
      const result = await this.#client.send(
        new GetObjectCommand({ Bucket: this.#bucket, Key: key }),
      )
      if (result.Body === undefined || result.ContentType === undefined) {
        throw new TypeError("stored evidence object is missing its body or content type")
      }
      return {
        bytes: await result.Body.transformToByteArray(),
        contentType: result.ContentType,
        key,
      }
    } catch (error) {
      if (error instanceof NoSuchKey) return null
      throw error
    }
  }

  async signRead(key: EvidenceObjectKey, expiresAt: Date): Promise<string> {
    const expiresIn = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1_000))
    return getSignedUrl(this.#client, new GetObjectCommand({ Bucket: this.#bucket, Key: key }), {
      expiresIn,
    })
  }

  async signUpload(target: EvidenceUploadTarget, expiresAt: Date): Promise<string> {
    const expiresIn = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1_000))
    return getSignedUrl(
      this.#client,
      new PutObjectCommand({
        Bucket: this.#bucket,
        ContentType: target.contentType,
        Key: target.key,
      }),
      { expiresIn },
    )
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
