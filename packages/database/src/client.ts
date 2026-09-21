import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { SQL } from "drizzle-orm";
import { Client } from "pg";

import {
  PostgresLoveChapterRepository,
  type QueryExecutor,
} from "./repository";

class DrizzleQueryExecutor implements QueryExecutor {
  constructor(private readonly database: NodePgDatabase) {}

  async execute<T extends Record<string, unknown>>(
    query: SQL,
  ): Promise<{ rows: T[] }> {
    const result = await this.database.execute<T>(query);
    return { rows: result.rows as unknown as T[] };
  }

  async transaction<T>(
    operation: (executor: QueryExecutor) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction((transaction) =>
      operation(new DrizzleQueryExecutor(transaction)),
    );
  }
}

export async function withPostgresRepository<T>(
  connectionString: string,
  operation: (repository: PostgresLoveChapterRepository) => Promise<T>,
): Promise<T> {
  if (!connectionString)
    throw new Error("PostgreSQL connection is not configured");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const database = drizzle({ client });
    return await operation(
      new PostgresLoveChapterRepository(new DrizzleQueryExecutor(database)),
    );
  } finally {
    await client.end();
  }
}
