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

export type PostgresClientFactory = (connectionString: string) => Client;

class LazyPostgresQueryExecutor implements QueryExecutor {
  private connection: Promise<DrizzleQueryExecutor> | null = null;
  private client: Client | null = null;

  constructor(
    private readonly connectionString: string,
    private readonly createClient: PostgresClientFactory,
  ) {}

  async execute<T extends Record<string, unknown>>(
    query: SQL,
  ): Promise<{ rows: T[] }> {
    return (await this.executor()).execute<T>(query);
  }

  async transaction<T>(
    operation: (executor: QueryExecutor) => Promise<T>,
  ): Promise<T> {
    return (await this.executor()).transaction(operation);
  }

  async close(): Promise<void> {
    if (this.client) await this.client.end();
  }

  private executor(): Promise<DrizzleQueryExecutor> {
    this.connection ??= this.connect();
    return this.connection;
  }

  private async connect(): Promise<DrizzleQueryExecutor> {
    const client = this.createClient(this.connectionString);
    await client.connect();
    this.client = client;
    return new DrizzleQueryExecutor(drizzle({ client }));
  }
}

export async function withPostgresRepository<T>(
  connectionString: string,
  operation: (repository: PostgresLoveChapterRepository) => Promise<T>,
  createClient: PostgresClientFactory = (value) =>
    new Client({ connectionString: value }),
): Promise<T> {
  if (!connectionString)
    throw new Error("PostgreSQL connection is not configured");
  const executor = new LazyPostgresQueryExecutor(
    connectionString,
    createClient,
  );
  try {
    return await operation(new PostgresLoveChapterRepository(executor));
  } finally {
    await executor.close();
  }
}
