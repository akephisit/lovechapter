import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { SQL } from "drizzle-orm";
import { Client, Pool, type PoolConfig } from "pg";

import {
  PostgresAuthRepository,
  PostgresEmailJobStore,
} from "./auth-repository";
import {
  PostgresLoveChapterRepository,
  type QueryExecutor,
} from "./repository";
import { PostgresGuestImportRepository } from "./guest-import-repository";
import { PostgresEnvelopeRepository } from "./envelope-repository";
import { PostgresPlanningRepository } from "./planning-repository";

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

export type PostgresRuntimeConfig = {
  databaseUrl: string;
  databasePoolMax: number;
};

export type PostgresRuntime = {
  pool: Pool;
  loveChapterRepository: PostgresLoveChapterRepository;
  guestImportRepository: PostgresGuestImportRepository;
  envelopeRepository: PostgresEnvelopeRepository;
  planningRepository: PostgresPlanningRepository;
  authRepository: PostgresAuthRepository;
  emailJobStore: PostgresEmailJobStore;
  close(): Promise<void>;
};

export function createPoolConfig(
  environment: Record<string, string | undefined>,
): PoolConfig {
  const connectionString = environment.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }
  const max = Number(environment.DATABASE_POOL_MAX ?? "6");
  if (!Number.isInteger(max) || max < 1 || max > 6) {
    throw new Error("DATABASE_POOL_MAX must be an integer between 1 and 6");
  }
  return {
    connectionString,
    max,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    query_timeout: 10_000,
  };
}

export function createPostgresRuntime(
  config: PostgresRuntimeConfig,
  createPool: (config: PoolConfig) => Pool = (poolConfig) =>
    new Pool(poolConfig),
): PostgresRuntime {
  const pool = createPool(
    createPoolConfig({
      DATABASE_URL: config.databaseUrl,
      DATABASE_POOL_MAX: String(config.databasePoolMax),
    }),
  );
  const executor = new DrizzleQueryExecutor(drizzle({ client: pool }));
  return {
    pool,
    loveChapterRepository: new PostgresLoveChapterRepository(executor),
    guestImportRepository: new PostgresGuestImportRepository(executor),
    envelopeRepository: new PostgresEnvelopeRepository(executor),
    planningRepository: new PostgresPlanningRepository(executor),
    authRepository: new PostgresAuthRepository(executor),
    emailJobStore: new PostgresEmailJobStore(executor),
    close: () => pool.end(),
  };
}

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
