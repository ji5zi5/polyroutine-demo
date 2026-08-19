import type { DatabaseHandle } from "@polyroutine/db"

export class LoginRateLimitRepository {
  constructor(private readonly database: DatabaseHandle) {}

  async isBlocked(rateKeyHash: string, now: Date): Promise<boolean> {
    const result = await this.database.pool.query<{ readonly blocked_until: Date | null }>(
      "select blocked_until from login_rate_limits where rate_key_hash = $1",
      [rateKeyHash],
    )
    const blockedUntil = result.rows[0]?.blocked_until
    return blockedUntil !== undefined && blockedUntil !== null && blockedUntil > now
  }

  async recordFailure(rateKeyHash: string, now: Date): Promise<void> {
    await this.database.pool.query(
      `insert into login_rate_limits(rate_key_hash, failure_count, window_started_at)
       values ($1, 1, $2)
       on conflict (rate_key_hash) do update set
         failure_count = case when login_rate_limits.window_started_at <= $2 - interval '15 minutes'
           then 1 else login_rate_limits.failure_count + 1 end,
         window_started_at = case when login_rate_limits.window_started_at <= $2 - interval '15 minutes'
           then $2 else login_rate_limits.window_started_at end,
         blocked_until = case when login_rate_limits.window_started_at > $2 - interval '15 minutes'
           and login_rate_limits.failure_count + 1 >= 5 then $2 + interval '15 minutes' else null end`,
      [rateKeyHash, now],
    )
  }

  async clear(rateKeyHash: string): Promise<void> {
    await this.database.pool.query("delete from login_rate_limits where rate_key_hash = $1", [
      rateKeyHash,
    ])
  }
}
