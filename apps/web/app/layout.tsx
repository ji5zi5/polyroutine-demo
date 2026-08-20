import type { Metadata, Viewport } from "next"
import Script from "next/script"
import type { ReactNode } from "react"
import "./globals.css"

export const metadata: Metadata = {
  description: "한 번에 하나의 학습 약속을 기록하고 증명하는 성인용 루틴 PWA",
  icons: { icon: "/icon.svg" },
  title: "폴리루틴",
}

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#ffffff",
  width: "device-width",
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const enableDevTools =
    process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_DISABLE_REACT_DEVTOOLS !== "1"

  return (
    <html lang="ko">
      <head>
        {enableDevTools ? (
          <>
            <Script
              crossOrigin="anonymous"
              src="https://unpkg.com/react-grab/dist/index.global.js"
              strategy="beforeInteractive"
            />
            <Script
              crossOrigin="anonymous"
              src="https://unpkg.com/react-scan/dist/auto.global.js"
              strategy="beforeInteractive"
            />
          </>
        ) : null}
      </head>
      <body>{children}</body>
    </html>
  )
}
