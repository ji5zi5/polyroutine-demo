import { z } from "zod"
import type { StagedPhoto } from "./verification-types.js"

export const ACCEPTED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const
export const MAX_STAGED_PHOTO_BYTES = 10 * 1024 * 1024
export const PHOTO_CHECK_DELAY_MS = 1_000

export const PHOTO_VERIFICATION_ERROR_MESSAGES = {
  "non-image": "이미지 파일만 선택할 수 있어요.",
  oversize: "사진은 10MB 이하만 선택할 수 있어요.",
  "preview-creation-failed": "사진 미리보기를 만들 수 없어요. 다시 시도해 주세요.",
  "unreadable-file": "사진 파일을 읽을 수 없어요. 다시 선택해 주세요.",
} as const

type AcceptedImageMimeType = (typeof ACCEPTED_IMAGE_MIME_TYPES)[number]
export type PhotoVerificationError = keyof typeof PHOTO_VERIFICATION_ERROR_MESSAGES

const stagedPhotoMetadataSchema = z.object({
  size: z.number().finite().nonnegative(),
  type: z.string(),
})

export function selectionError(file: StagedPhoto): PhotoVerificationError | null {
  const parsed = stagedPhotoMetadataSchema.safeParse({ size: file.size, type: file.type })
  if (!parsed.success || parsed.data.size === 0) return "unreadable-file"
  if (!isAcceptedImageMimeType(parsed.data.type)) return "non-image"
  if (parsed.data.size > MAX_STAGED_PHOTO_BYTES) return "oversize"
  return null
}

function isAcceptedImageMimeType(value: string): value is AcceptedImageMimeType {
  return ACCEPTED_IMAGE_MIME_TYPES.some((mimeType) => mimeType === value)
}
