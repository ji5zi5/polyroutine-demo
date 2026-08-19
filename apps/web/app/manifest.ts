import type { MetadataRoute } from "next"

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#fffdf9",
    description: "하루 한 가지 학습 약속을 위한 성인용 루틴 PWA",
    display: "standalone",
    lang: "ko",
    name: "폴리루틴",
    orientation: "portrait-primary",
    scope: "/",
    short_name: "폴리루틴",
    start_url: "/",
    theme_color: "#0b63ce",
  }
}
