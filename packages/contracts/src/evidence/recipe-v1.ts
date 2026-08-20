export const evidenceRecipeV1 = {
  capture: {
    challengeExpiresInSeconds: 600,
    claim: "replay_reduction_only",
    kind: "server_guided_challenge",
  },
  fixtures: [
    {
      description:
        "One frame clearly shows today's date, the current server challenge code, and at least three readable lines of study notes.",
      verdict: "positive",
    },
    {
      description:
        "The frame is clearly missing the current challenge code, today's date, or the required three study-note lines.",
      verdict: "negative",
    },
    {
      description:
        "Glare, cropping, blur, or occlusion prevents a reliable visual comparison with the guided requirements.",
      verdict: "inconclusive",
    },
  ],
  id: "study_note_photo_v1",
  instructions:
    "After studying for 25 minutes, photograph today's date, the server challenge code, and at least 3 lines of today's study notes together in one frame.",
  noteLineMinimum: 3,
  version: 1,
} as const

export type EvidenceRecipeV1 = typeof evidenceRecipeV1
