import sharp from "sharp"
import { describe, expect, it } from "vitest"
import { decodeEvidenceImage } from "./image.js"

describe("evidence image boundary", () => {
  it.each([
    ["jpeg", "image/jpeg", "jpg"],
    ["png", "image/png", "png"],
    ["webp", "image/webp", "webp"],
  ] as const)("decodes allowed %s uploads", async (format, contentType, extension) => {
    // Given
    const upload = await sharp({
      create: { background: "white", channels: 3, height: 4, width: 5 },
    })
      .toFormat(format)
      .toBuffer()

    // When
    const decoded = await decodeEvidenceImage(upload, contentType)

    // Then
    expect(decoded).toMatchObject({ contentType, extension, height: 4, width: 5 })
  })

  it("sanitizes trailing polyglot content before quarantine", async () => {
    // Given
    const image = await sharp({
      create: { background: "white", channels: 3, height: 4, width: 5 },
    })
      .png()
      .toBuffer()
    const marker = Buffer.from("MZ-polyglot-executable")
    const upload = Buffer.concat([image, marker])

    // When
    const decoded = await decodeEvidenceImage(upload, "image/png")

    // Then
    expect(decoded.uploadedByteSize).toBe(upload.byteLength)
    expect(decoded.bytes.includes(marker)).toBe(false)
    await expect(sharp(decoded.bytes).metadata()).resolves.toMatchObject({ height: 4, width: 5 })
  })

  it("strips embedded EXIF before quarantine", async () => {
    // Given
    const upload = await sharp({
      create: { background: "white", channels: 3, height: 4, width: 5 },
    })
      .jpeg()
      .withExif({ IFD0: { Copyright: "private-device-metadata" } })
      .toBuffer()

    // When
    const decoded = await decodeEvidenceImage(upload, "image/jpeg")
    const quarantinedMetadata = await sharp(decoded.bytes).metadata()

    // Then
    expect(decoded).toMatchObject({ contentType: "image/jpeg", height: 4, width: 5 })
    expect(quarantinedMetadata.exif).toBeUndefined()
  })

  it("rejects declared content that disagrees with magic bytes", async () => {
    // Given
    const upload = await sharp({
      create: { background: "white", channels: 3, height: 1, width: 1 },
    })
      .png()
      .toBuffer()

    // When
    const result = decodeEvidenceImage(upload, "image/webp")

    // Then
    await expect(result).rejects.toEqual(expect.objectContaining({ code: "IMAGE_TYPE_MISMATCH" }))
  })
})
