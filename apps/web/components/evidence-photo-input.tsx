"use client"

import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react"

type EvidencePhotoInputProps = {
  readonly disabled: boolean
  readonly onCameraMessage: (message: string | null) => void
  readonly onPhoto: (file: File) => void
}

export function EvidencePhotoInput({
  disabled,
  onCameraMessage,
  onPhoto,
}: EvidencePhotoInputProps) {
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraBusy, setCameraBusy] = useState(false)
  const streamRef = useRef<MediaStream | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const stopCamera = useCallback((): void => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop()
    streamRef.current = null
    if (videoRef.current !== null) videoRef.current.srcObject = null
    setCameraActive(false)
  }, [])

  useEffect(() => stopCamera, [stopCamera])

  const openCamera = async (): Promise<void> => {
    onCameraMessage(null)
    if (navigator.mediaDevices?.getUserMedia === undefined) {
      onCameraMessage("이 브라우저에서는 카메라를 열 수 없어요. 사진 선택으로 계속할 수 있어요.")
      return
    }
    setCameraBusy(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      })
      streamRef.current = stream
      if (videoRef.current !== null) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setCameraActive(true)
    } catch (error) {
      stopCamera()
      if (error instanceof DOMException && error.name === "NotAllowedError") {
        onCameraMessage("카메라 권한이 없어요. 사진 선택으로 계속할 수 있어요.")
        return
      }
      if (error instanceof DOMException || error instanceof TypeError) {
        onCameraMessage("카메라를 열지 못했어요. 사진 선택으로 계속할 수 있어요.")
        return
      }
      throw error
    } finally {
      setCameraBusy(false)
    }
  }

  const capturePhoto = async (): Promise<void> => {
    const video = videoRef.current
    if (video === null || video.videoWidth === 0 || video.videoHeight === 0) {
      onCameraMessage("카메라 화면을 준비하고 있어요. 잠시 뒤 다시 촬영해 주세요.")
      return
    }
    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext("2d")
    if (context === null) {
      onCameraMessage("사진 프레임을 만들지 못했어요. 사진 선택으로 계속할 수 있어요.")
      return
    }
    context.drawImage(video, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9),
    )
    if (blob === null) {
      onCameraMessage("사진 파일을 만들지 못했어요. 사진 선택으로 계속할 수 있어요.")
      return
    }
    onPhoto(new File([blob], "today-study-note.jpg", { type: blob.type }))
    stopCamera()
  }

  const selectFile = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0]
    if (file !== undefined) onPhoto(file)
    event.currentTarget.value = ""
  }

  return (
    <div className="stack">
      <div className="captureActions">
        <button
          className="buttonQuiet"
          disabled={disabled || cameraBusy}
          onClick={() => void openCamera()}
          type="button"
        >
          {cameraBusy ? "카메라 확인 중" : "카메라 열기"}
        </button>
        <label className="quietLink captureFileLabel">
          사진 선택하기
          <input
            accept="image/jpeg,image/png,image/webp"
            aria-label="학습 노트 사진 선택"
            capture="environment"
            className="visuallyHidden"
            disabled={disabled}
            onChange={selectFile}
            type="file"
          />
        </label>
      </div>
      <p className="formHelper">
        카메라 선택은 기기 편의 기능일 뿐 실제 학습 완료, 사진 진위, 실시간 촬영을 증명하지 않아요.
      </p>
      <div className="captureCamera" hidden={!cameraActive}>
        <video aria-label="카메라 미리보기" muted playsInline ref={videoRef} />
        <div className="captureActions">
          <button onClick={() => void capturePhoto()} type="button">
            이 화면 촬영하기
          </button>
          <button className="buttonQuiet" onClick={stopCamera} type="button">
            카메라 닫기
          </button>
        </div>
      </div>
    </div>
  )
}
