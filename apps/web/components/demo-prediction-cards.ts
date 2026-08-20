import type { PredictionCardModel, PredictionChoice } from "./prediction-card"

const seedCards = [
  {
    anonymousAlias: "공부하는 수달",
    aiPercent: 59,
    goalId: "demo-1",
    yesPercent: 64,
    recipe: {
      id: "study_note_photo_v1",
      instructions: "수학 오답노트 3문제를 풀어요.",
      version: 1,
    },
  },
  {
    anonymousAlias: "책 읽는 여우",
    aiPercent: 68,
    goalId: "demo-2",
    yesPercent: 71,
    recipe: {
      id: "study_note_photo_v1",
      instructions: "책 15쪽을 읽고 핵심을 3줄로 기록해요.",
      version: 1,
    },
  },
  {
    anonymousAlias: "집중하는 고양이",
    aiPercent: 63,
    goalId: "demo-3",
    tasks: ["온라인 강의 25분 듣기", "배운 내용 3줄 정리하기"],
    yesPercent: 58,
    recipe: {
      id: "study_note_photo_v1",
      instructions: "오늘 목표 2개를 모두 끝내요.",
      version: 1,
    },
  },
  {
    anonymousAlias: "성실한 참새",
    aiPercent: 78,
    goalId: "demo-4",
    yesPercent: 82,
    recipe: { id: "study_note_photo_v1", instructions: "영어 단어 20개를 복습해요.", version: 1 },
  },
  {
    anonymousAlias: "달리는 토끼",
    aiPercent: 52,
    goalId: "demo-5",
    yesPercent: 47,
    recipe: { id: "study_note_photo_v1", instructions: "저녁에 30분 달려요.", version: 1 },
  },
  {
    anonymousAlias: "준비하는 판다",
    aiPercent: 65,
    goalId: "demo-6",
    yesPercent: 69,
    recipe: {
      id: "study_note_photo_v1",
      instructions: "포트폴리오 소개 문장을 5줄 다듬어요.",
      version: 1,
    },
  },
  {
    anonymousAlias: "운동하는 라쿤",
    aiPercent: 72,
    goalId: "demo-7",
    yesPercent: 76,
    recipe: {
      id: "study_note_photo_v1",
      instructions: "잠들기 전에 스트레칭을 15분 해요.",
      version: 1,
    },
  },
  {
    anonymousAlias: "연습하는 펭귄",
    aiPercent: 57,
    goalId: "demo-8",
    yesPercent: 53,
    recipe: {
      id: "study_note_photo_v1",
      instructions: "면접 예상 질문 3개에 답을 적어요.",
      version: 1,
    },
  },
] as const satisfies readonly Omit<
  PredictionCardModel,
  "evidenceDeadlineAt" | "predictionCutoffAt"
>[]

const goalExamples = [
  "수학 기출 10문제 풀기",
  "전공 강의 30분 듣기",
  "영어 단어 20개 복습하기",
  "책 15쪽 읽기",
  "면접 답변 3개 녹음하기",
  "저녁에 3km 달리기",
  "플랭크 3세트 하기",
  "물 8잔 마시기",
  "자정 전에 잠들기",
  "책상 10분 정리하기",
  "오늘 지출 내역 기록하기",
  "포트폴리오 문장 5줄 다듬기",
  "알고리즘 문제 2개 풀기",
  "뉴스레터 1편 요약하기",
  "일본어 단어 15개 외우기",
  "아침 스트레칭 10분 하기",
  "감사 일기 3줄 쓰기",
  "밀린 이메일 5개 답장하기",
  "자격증 오답 1단원 복습하기",
  "점심 뒤 20분 산책하기",
  "개인 프로젝트 기능 1개 완성하기",
  "발표 대본 2번 소리 내어 읽기",
  "유튜브 대신 음악 들으며 쉬기",
  "방 청소 20분 끝내기",
  "하체 운동 4종목 하기",
  "논문 초록 2편 읽기",
  "코딩 테스트 1회 풀기",
  "카페인 오후 3시 전에 끊기",
  "내일 할 일 5개 정리하기",
  "사진 20장 정리하기",
  "경제 기사 2개 읽기",
  "친구에게 안부 연락하기",
  "영어 회화 15분 연습하기",
  "침구 정리하고 환기하기",
  "강의 노트 1장 다시 쓰기",
  "스쿼트 50개 완료하기",
] as const

const aliasAdjectives = [
  "꾸준한",
  "몰입한",
  "부지런한",
  "차분한",
  "도전하는",
  "성장하는",
  "새벽형",
  "집중한",
  "반전의",
  "계획적인",
  "끈기 있는",
  "오늘도 하는",
] as const

const aliasAnimals = [
  "고래",
  "다람쥐",
  "두더지",
  "레서판다",
  "물개",
  "부엉이",
  "사막여우",
  "알파카",
  "코알라",
  "해달",
] as const

const generatedCards = Array.from({ length: 120 }, (_, index): PredictionCardModel => {
  const bundleSize = index % 7 === 0 ? 3 : index % 3 === 0 ? 2 : 1
  const tasks = Array.from(
    { length: bundleSize },
    (_, taskIndex) =>
      goalExamples[(index * 3 + taskIndex * 11) % goalExamples.length] ?? goalExamples[0],
  )
  const primaryTask = tasks[0] ?? goalExamples[0]

  return {
    aiPercent: 35 + ((index * 19) % 55),
    anonymousAlias: `${aliasAdjectives[Math.floor(index / aliasAnimals.length)]} ${aliasAnimals[index % aliasAnimals.length]}`,
    evidenceDeadlineAt: "2099-01-01T23:00:00.000Z",
    goalId: `demo-${index + seedCards.length + 1}`,
    predictionCutoffAt: "2099-01-01T13:00:00.000Z",
    recipe: {
      id: "study_note_photo_v1",
      instructions: bundleSize === 1 ? primaryTask : `오늘 목표 ${bundleSize}개를 모두 끝내요.`,
      version: 1,
    },
    ...(bundleSize === 1 ? {} : { tasks }),
    yesPercent: 25 + ((index * 17) % 61),
  }
})

export const predictionCards: readonly PredictionCardModel[] = [
  ...seedCards.map((card) => ({
    ...card,
    evidenceDeadlineAt: "2099-01-01T23:00:00.000Z",
    predictionCutoffAt: "2099-01-01T13:00:00.000Z",
  })),
  ...generatedCards,
]

const seedOutcomes: readonly PredictionChoice[] = [
  "no",
  "yes",
  "yes",
  "no",
  "yes",
  "no",
  "yes",
  "no",
]

export const demoPredictionOutcomes: Readonly<Record<string, PredictionChoice>> =
  Object.fromEntries(
    predictionCards.map((card, index) => [
      card.goalId,
      seedOutcomes[index] ?? (index % 3 === 0 ? "yes" : "no"),
    ]),
  )
