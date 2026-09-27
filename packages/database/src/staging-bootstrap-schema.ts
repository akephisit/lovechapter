import type { Client } from "pg";

import { pendingMigrations } from "./migration-history";

const migration = "packages/database/drizzle/0011_release_versions.sql";

/** This one-time path must never operate on a mixed or post-0010 schema. */
export async function assertStagingBootstrapSchema(
  client: Client,
): Promise<void> {
  const columns = await client.query<{ column_name: string }>(
    `select column_name from information_schema.columns
     where table_schema = 'ops' and table_name = 'release_control'
       and column_name in ('web_version_id', 'web_source_sha', 'api_version_id', 'api_source_sha')`,
  );
  if (columns.rows.length !== 0) {
    throw new Error("Release schema is not the pre-0011 prefix");
  }
  const pending = await pendingMigrations(client);
  if (pending.length !== 1 || pending[0] !== migration) {
    throw new Error("Migration ledger is not the exact 0010 prefix");
  }
}
