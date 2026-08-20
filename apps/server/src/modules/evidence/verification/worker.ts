import type { DatabaseHandle } from "@polyroutine/db"
import type { PgBoss } from "pg-boss"
import { z } from "zod"
import type { VerificationService } from "./service.js"

export const VERIFICATION_QUEUE = "evidence-verification" as const
const VERIFICATION_DEAD_LETTER_QUEUE = "evidence-verification-dead-letter"
const VERIFICATION_DISPATCH_QUEUE = "evidence-verification-dispatch"
const verificationJobSchema = z.strictObject({ verificationJobId: z.uuid() })

export class MalformedVerificationJobError extends Error {
  override readonly name = "MalformedVerificationJobError"

  constructor() {
    super("verification job payload is malformed")
  }
}

export class VerificationJobInterruptedError extends Error {
  override readonly name = "VerificationJobInterruptedError"

  constructor() {
    super("verification job was interrupted")
  }
}

type VerificationWorkItem = {
  readonly data: unknown
  readonly signal: AbortSignal
}

export function createVerificationWorkHandler(service: Pick<VerificationService, "promoteJob">) {
  return async (jobs: readonly VerificationWorkItem[]): Promise<void> => {
    for (const job of jobs) {
      if (job.signal.aborted) throw new VerificationJobInterruptedError()
      const payload = verificationJobSchema.safeParse(job.data)
      if (!payload.success) throw new MalformedVerificationJobError()
      await service.promoteJob(payload.data.verificationJobId)
      if (job.signal.aborted) throw new VerificationJobInterruptedError()
    }
  }
}

export async function dispatchVerificationJobs(
  boss: PgBoss,
  database: DatabaseHandle,
): Promise<number> {
  const queued = await database.pool.query<{
    readonly business_key: string
    readonly id: string
  }>(
    `select id::text, business_key from verification_jobs
     where state = 'queued' order by created_at, id limit 100`,
  )
  for (const job of queued.rows) {
    await boss.send(
      VERIFICATION_QUEUE,
      { verificationJobId: job.id },
      { singletonKey: job.business_key },
    )
  }
  return queued.rows.length
}

export async function registerVerificationWorker(
  boss: PgBoss,
  database: DatabaseHandle,
  service: VerificationService,
): Promise<void> {
  await boss.createQueue(VERIFICATION_DEAD_LETTER_QUEUE, {
    deleteAfterSeconds: 24 * 60 * 60,
    retryLimit: 0,
  })
  await boss.createQueue(VERIFICATION_QUEUE, {
    deadLetter: VERIFICATION_DEAD_LETTER_QUEUE,
    deleteAfterSeconds: 24 * 60 * 60,
    expireInSeconds: 15,
    retryBackoff: true,
    retryDelay: 1,
    retryDelayMax: 4,
    retryLimit: 2,
    warningQueueSize: 100,
  })
  await boss.createQueue(VERIFICATION_DISPATCH_QUEUE, {
    deleteAfterSeconds: 24 * 60 * 60,
    policy: "exclusive",
    retryLimit: 2,
  })
  await boss.work<unknown>(VERIFICATION_QUEUE, createVerificationWorkHandler(service))
  await boss.work(VERIFICATION_DISPATCH_QUEUE, async () => {
    await dispatchVerificationJobs(boss, database)
  })
  await boss.schedule(
    VERIFICATION_DISPATCH_QUEUE,
    "* * * * *",
    {},
    { key: "verification-outbox-v1" },
  )
  await dispatchVerificationJobs(boss, database)
}
