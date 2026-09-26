import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { readMigrationFiles } from "drizzle-orm/migrator";
import type { Client } from "pg";

import { expectedSchemaMigrationHash } from "./schema-revision";

export const migrationFolder = fileURLToPath(
  new URL("../drizzle/", import.meta.url),
);

export function checkedInMigrations() {
  const journal = JSON.parse(
    readFileSync(
      new URL("../drizzle/meta/_journal.json", import.meta.url),
      "utf8",
    ),
  ) as { entries?: Array<{ tag: string; when: number }> };
  const files = readMigrationFiles({ migrationsFolder: migrationFolder });
  if (
    !Array.isArray(journal.entries) ||
    journal.entries.length !== files.length ||
    journal.entries.length > 1000
  ) {
    throw new Error("Migration journal is invalid");
  }
  const migrations = journal.entries.map((entry, index) => {
    if (
      !/^[A-Za-z0-9_-]+$/u.test(entry.tag) ||
      !Number.isSafeInteger(entry.when) ||
      files[index]?.folderMillis !== entry.when ||
      (index > 0 && entry.when <= journal.entries![index - 1]!.when)
    ) {
      throw new Error("Migration journal is invalid");
    }
    return {
      path: `packages/database/drizzle/${entry.tag}.sql`,
      hash: files[index]!.hash,
      when: entry.when,
    };
  });
  if (migrations.at(-1)?.hash !== expectedSchemaMigrationHash) {
    throw new Error("Expected schema revision differs from checked-in history");
  }
  return migrations;
}

export async function pendingMigrations(client: Client, allowCurrent = false) {
  const checkedIn = checkedInMigrations();
  const ledger = await client.query<{ hash: string; created_at: string }>(
    `select hash, created_at::text from drizzle.__drizzle_migrations
     order by created_at, id limit 1001`,
  );
  if (
    ledger.rows.length === 0 ||
    ledger.rows.length > 1000 ||
    ledger.rows.length > checkedIn.length ||
    (!allowCurrent && ledger.rows.length === checkedIn.length) ||
    ledger.rows.some(
      (row, index) =>
        row.hash !== checkedIn[index]?.hash ||
        Number(row.created_at) !== checkedIn[index]?.when,
    )
  ) {
    throw new Error(
      "Deployed migration ledger differs from checked-in history",
    );
  }
  return checkedIn.slice(ledger.rows.length).map((entry) => entry.path);
}
