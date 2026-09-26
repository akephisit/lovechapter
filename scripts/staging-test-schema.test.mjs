import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { URL } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { syncStagingTestSchema } from "./staging-test-schema.mjs";

const journal = JSON.parse(
  readFileSync(
    new URL("../packages/database/drizzle/meta/_journal.json", import.meta.url),
    "utf8",
  ),
);
const rows = journal.entries.map((entry) => ({
  hash: createHash("sha256")
    .update(
      readFileSync(
        new URL(
          `../packages/database/drizzle/${entry.tag}.sql`,
          import.meta.url,
        ),
      ),
    )
    .digest("hex"),
  created_at: String(entry.when),
}));
const readUrl =
  "postgresql://tester:read-password@ep-test.neon.tech/lovechapter?sslmode=require";
const migrationUrl =
  "postgresql://migrator:write-password@ep-test.neon.tech/lovechapter?sslmode=require";

function fixture() {
  let ledger = rows.slice(0, -1);
  const query = vi.fn(async () => ({ rows: ledger }));
  const connect = vi.fn(async () => undefined);
  const end = vi.fn(async () => undefined);
  const client = { query, connect, end };
  const createClient = vi.fn(() => client);
  const migrateDatabase = vi.fn(async () => {
    ledger = rows;
  });
  return {
    input: {
      readUrl,
      migrationUrl,
      migrationRole: "migrator",
      database: "lovechapter",
      activeHost: "ep-staging.neon.tech",
    },
    createClient,
    migrateDatabase,
    query,
    connect,
    end,
    setLedger: (value) => {
      ledger = value;
    },
  };
}

describe("isolated staging-test schema sync", () => {
  it("applies only reviewed pending migrations and confirms the exact ledger", async () => {
    const context = fixture();
    await expect(
      syncStagingTestSchema(context.input, context),
    ).resolves.toEqual({ applied: 1 });
    expect(context.createClient).toHaveBeenCalledExactlyOnceWith(migrationUrl);
    expect(context.migrateDatabase).toHaveBeenCalledOnce();
    expect(context.end).toHaveBeenCalledOnce();
  });

  it("does not migrate when the test branch already has the current ledger", async () => {
    const context = fixture();
    context.setLedger(rows);
    await expect(
      syncStagingTestSchema(context.input, context),
    ).resolves.toEqual({ applied: 0 });
    expect(context.migrateDatabase).not.toHaveBeenCalled();
  });

  it("rejects mismatched host, database, role, or non-direct URL before connecting", async () => {
    for (const edit of [
      { migrationRole: "tester" },
      { migrationRole: "other" },
      { migrationUrl: migrationUrl.replace("ep-test", "ep-staging") },
      { migrationUrl: migrationUrl.replace("/lovechapter?", "/other?") },
      { migrationUrl: migrationUrl.replace("ep-test.", "ep-test-pooler.") },
    ]) {
      const context = fixture();
      await expect(
        syncStagingTestSchema({ ...context.input, ...edit }, context),
      ).rejects.toThrow();
      expect(context.createClient).not.toHaveBeenCalled();
    }
  });

  it("rejects drift, missing review, or an incomplete post-migration ledger", async () => {
    const drift = fixture();
    drift.setLedger([{ ...rows[0], hash: "wrong" }, ...rows.slice(1, -1)]);
    await expect(syncStagingTestSchema(drift.input, drift)).rejects.toThrow();
    expect(drift.migrateDatabase).not.toHaveBeenCalled();

    const review = fixture();
    await expect(
      syncStagingTestSchema(review.input, {
        ...review,
        readReview: vi.fn(async () => {
          throw new Error("missing review");
        }),
      }),
    ).rejects.toThrow();
    expect(review.migrateDatabase).not.toHaveBeenCalled();

    const incomplete = fixture();
    incomplete.migrateDatabase.mockResolvedValueOnce(undefined);
    await expect(
      syncStagingTestSchema(incomplete.input, incomplete),
    ).rejects.toThrow();
    expect(incomplete.end).toHaveBeenCalledOnce();
  });
});
