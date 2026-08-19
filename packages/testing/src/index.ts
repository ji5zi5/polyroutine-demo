import type { StartedPostgreSqlContainer } from "@testcontainers/postgresql"
import { PostgreSqlContainer } from "@testcontainers/postgresql"

export type TestPostgres = {
  readonly connectionString: string
  readonly container: StartedPostgreSqlContainer
}

export async function startTestPostgres(): Promise<TestPostgres> {
  const container = await new PostgreSqlContainer("postgres:17.6-alpine")
    .withDatabase("poly_routine_test")
    .withPassword("poly_routine_test")
    .withUsername("poly_routine_test")
    .start()

  return { connectionString: container.getConnectionUri(), container }
}
