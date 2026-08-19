import type { SubjectKey } from "@polyroutine/contracts"
import type { DatabaseHandle } from "@polyroutine/db"
import type { DeleteAccountRecord, DeleteAccountResult } from "./repository.js"

export class AccountDeletionRepository {
  constructor(private readonly database: DatabaseHandle) {}

  async deleteAccount(record: DeleteAccountRecord): Promise<DeleteAccountResult> {
    const client = await this.database.pool.connect()
    try {
      await client.query("begin")
      await client.query("set local poly_routine.account_deletion = 'on'")
      const locked = await client.query(
        "select subject_key from accounts where subject_key = $1 for update",
        [record.subjectKey],
      )
      if (locked.rowCount !== 1) throw new TypeError("account is unavailable for deletion")
      await client.query("insert into users(subject_key, timezone) values ($1, 'UTC')", [
        record.tombstoneKey,
      ])
      const goals = await client.query<{ readonly id: string; readonly state: string }>(
        "select id, state from goals where owner_subject_key = $1 for update",
        [record.subjectKey],
      )
      const cancelledGoalCount = goals.rows.filter(
        ({ state }) => state === "prediction_open" || state === "evidence_open",
      ).length
      await client.query(
        `update goals set owner_subject_key = $2,
           state = case when state in ('prediction_open', 'evidence_open') then 'cancelled' else state end
         where owner_subject_key = $1`,
        [record.subjectKey, record.tombstoneKey],
      )
      const subjectColumns = [
        ["predictions", "predictor_subject_key"],
        ["feed_exposures", "viewer_subject_key"],
        ["evidence_challenges", "owner_subject_key"],
        ["evidences", "owner_subject_key"],
        ["reputation_events", "subject_key"],
        ["goal_correction_events", "operator_subject_key"],
      ] as const
      for (const [table, column] of subjectColumns) {
        await client.query(`update ${table} set ${column} = $2 where ${column} = $1`, [
          record.subjectKey,
          record.tombstoneKey,
        ])
      }
      await client.query("delete from sessions where subject_key = $1", [record.subjectKey])
      await client.query("delete from accounts where subject_key = $1", [record.subjectKey])
      await client.query("delete from users where subject_key = $1", [record.subjectKey])
      await client.query(
        `insert into account_deletion_jobs(id, tombstone_subject_key, job_kind, goal_ids)
         values ($1, $2, 'delete_account_images', $3::jsonb)`,
        [
          record.imageDeletionJobId,
          record.tombstoneKey,
          JSON.stringify(goals.rows.map(({ id }) => id)),
        ],
      )
      const tombstone = await client.query<{ readonly subject_key: SubjectKey }>(
        `insert into account_deletion_audits(id, tombstone_subject_key, image_deletion_job_id,
           cancelled_goal_count, result)
         values ($1, $2, $3, $4, 'pii_removed_sessions_revoked') returning tombstone_subject_key as subject_key`,
        [record.auditId, record.tombstoneKey, record.imageDeletionJobId, cancelledGoalCount],
      )
      await client.query("commit")
      const tombstoneSubjectKey = tombstone.rows[0]?.subject_key
      if (tombstoneSubjectKey === undefined) throw new TypeError("deletion audit has no tombstone")
      return {
        cancelledGoalCount,
        imageDeletionJobId: record.imageDeletionJobId,
        tombstoneSubjectKey,
      }
    } catch (error) {
      await client.query("rollback")
      throw error
    } finally {
      client.release()
    }
  }
}
