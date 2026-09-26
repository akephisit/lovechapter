import { readFile } from "node:fs/promises";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import {
  migrationFolder,
  pendingMigrations,
} from "../packages/database/src/migration-history.ts";
import { validateDirectDatabaseUrl } from "../packages/database/src/release-target.ts";
import { validateMigrationReviews } from "./migration-review.mjs";

/** Synchronize only a provider-verified disposable test branch before any release closure. */
export async function syncStagingTestSchema(
  { readUrl, migrationUrl, migrationRole, database, activeHost },
  {
    createClient = (connectionString) =>
      new pg.Client({
        connectionString,
        connectionTimeoutMillis: 5_000,
        query_timeout: 30_000,
      }),
    migrateDatabase = (client) =>
      migrate(drizzle({ client }), { migrationsFolder: migrationFolder }),
    readReview = (path) => readFile(path, "utf8"),
  } = {},
) {
  const read = validateDirectDatabaseUrl(readUrl);
  const write = validateDirectDatabaseUrl(migrationUrl);
  if (
    !migrationRole ||
    migrationRole.startsWith("REPLACE_WITH_") ||
    decodeURIComponent(write.username) !== migrationRole ||
    decodeURIComponent(read.username) === migrationRole ||
    write.hostname !== read.hostname ||
    write.hostname === activeHost ||
    decodeURIComponent(write.pathname.slice(1)) !== database ||
    decodeURIComponent(read.pathname.slice(1)) !== database
  ) {
    throw new Error("Isolated migration target is invalid");
  }
  const client = createClient(migrationUrl);
  try {
    await client.connect();
    const pending = await pendingMigrations(client, true);
    if (pending.length > 0) {
      const review = await validateMigrationReviews(
        pending.map((path) => ({ status: "A", path })),
        readReview,
      );
      if (review.kind === "blocked" || review.paths.length !== pending.length) {
        throw new Error("Pending isolated migrations are not reviewed");
      }
      await migrateDatabase(client);
      if ((await pendingMigrations(client, true)).length !== 0) {
        throw new Error("Isolated migration ledger did not converge");
      }
    }
    return { applied: pending.length };
  } finally {
    await client.end();
  }
}
