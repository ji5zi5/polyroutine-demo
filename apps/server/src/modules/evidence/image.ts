import { createHash } from "node:crypto"
import sharp from "sharp"

const MAX_DIMENSION = 8_192
const MAX_PIXELS = 40_000_000

export const acceptedEvidenceContentTypes = ["image/jpeg", "image/png", "image/webp"] as const
export type EvidenceContentType = (typeof acceptedEvidenceContentTypes)[number]

export type EvidenceImage = {
  readonly bytes: Buffer
  readonly contentType: EvidenceContentType
  readonly extension: "jpg" | "png" | "webp"
  readonly height: number
  readonly sha256: string
  readonly uploadedByteSize: number
  readonly width: number
}

export class EvidenceImageError extends Error {
  override readonly name = "EvidenceImageError"

  constructor(
    readonly code: "IMAGE_LIMIT_EXCEEDED" | "IMAGE_TYPE_MISMATCH" | "INVALID_IMAGE",
    readonly statusCode: 415 | 422,
  ) {
    super(code)
  }
}

function contentTypeFromMagic(bytes: Uint8Array): EvidenceContentType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png"
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg"
  }
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  ) {
    return "image/webp"
  }
  return null
}

function isLimitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /pixel limit|dimensions? (?:exceed|too large)|width or height/i.test(error.message)
  )
}

export async function decodeEvidenceImage(
  bytes: Uint8Array,
  declaredContentType: string,
): Promise<EvidenceImage> {
  const detectedContentType = contentTypeFromMagic(bytes)
  if (detectedContentType === null || detectedContentType !== declaredContentType) {
    throw new EvidenceImageError("IMAGE_TYPE_MISMATCH", 415)
  }

  try {
    const decoder = sharp(bytes, {
      animated: false,
      failOn: "error",
      limitInputPixels: MAX_PIXELS,
      sequentialRead: true,
    })
    const metadata = await decoder.metadata()
    const width = metadata.width
    const height = metadata.height
    if (
      width === undefined ||
      height === undefined ||
      width < 1 ||
      height < 1 ||
      width > MAX_DIMENSION ||
      height > MAX_DIMENSION ||
      width * height > MAX_PIXELS ||
      (metadata.pages ?? 1) !== 1
    ) {
      throw new EvidenceImageError("IMAGE_LIMIT_EXCEEDED", 422)
    }

    let stripped: Buffer
    let extension: EvidenceImage["extension"]
    switch (detectedContentType) {
      case "image/jpeg":
        stripped = await decoder.rotate().jpeg({ quality: 90 }).toBuffer()
        extension = "jpg"
        break
      case "image/png":
        stripped = await decoder.rotate().png().toBuffer()
        extension = "png"
        break
      case "image/webp":
        stripped = await decoder.rotate().webp({ quality: 90 }).toBuffer()
        extension = "webp"
        break
    }

    return {
      bytes: stripped,
      contentType: detectedContentType,
      extension,
      height,
      sha256: createHash("sha256").update(stripped).digest("hex"),
      uploadedByteSize: bytes.byteLength,
      width,
    }
  } catch (error) {
    if (error instanceof EvidenceImageError) throw error
    if (isLimitError(error)) throw new EvidenceImageError("IMAGE_LIMIT_EXCEEDED", 422)
    throw new EvidenceImageError("INVALID_IMAGE", 422)
  }
}
