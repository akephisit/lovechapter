import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Client } from "pg";
import { describe, expect, it, vi } from "vitest";

import { runReleaseMigrationCli } from "./release-migration-cli";

const sha = "a".repeat(40);
const closedAt = "2026-09-26 06:00:00+00";
const host = "ep-staging.ap-southeast-1.aws.neon.tech";
const reviewed = "packages/database/drizzle/0011_release_versions.sql";
const journal = JSON.parse(
  readFileSync(
    new URL("../drizzle/meta/_journal.json", import.meta.url),
    "utf8",
  ),
) as { entries: Array<{ tag: string; when: number }> };
const previous = journal.entries.at(-2)!;
const ledger = journal.entries.slice(0, -1).map((entry) => ({
  hash: createHash("sha256")
    .update(
      readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url)),
    )
    .digest("hex"),
  created_at: String(entry.when),
}));
const args = ["--sha", sha, "--closed-at", closedAt, "--reviewed", reviewed];

function fixture() {
  const environment = {
    RELEASE_ENVIRONMENT: "staging",
    RELEASE_DATABASE_URL: `postgresql://release:gate-password@${host}/lovechapter?sslmode=require`,
    RELEASE_DATABASE_ROLE: "release",
    RELEASE_MIGRATION_DATABASE_URL: `postgresql://migrator:migration-password@${host}/lovechapter?sslmode=require`,
    RELEASE_MIGRATION_DATABASE_ROLE: "migrator",
    RELEASE_APP_DATABASE_ROLE: "app",
    RELEASE_NEON_PROJECT_ID: "icy-hat-79862899",
    RELEASE_NEON_BRANCH_ID: "br-staging-123",
    RELEASE_DATABASE_NAME: "lovechapter",
    RELEASE_CLOUDFLARE_ACCOUNT_ID: "cf-account-123",
    RELEASE_HYPERDRIVE_ID: "staging-hyperdrive-123",
    RELEASE_NEON_API_KEY: "neon-test-secret",
    RELEASE_CLOUDFLARE_API_TOKEN: "cf-test-secret",
  };
  const fetcher = vi.fn(async (input: string | URL | Request) =>
    String(input).startsWith("https://console.neon.tech/")
      ? new Response(
          JSON.stringify({
            endpoints: [
              {
                branch_id: environment.RELEASE_NEON_BRANCH_ID,
                host,
                type: "read_write",
              },
            ],
          }),
          { status: 200 },
        )
      : new Response(
          JSON.stringify({
            success: true,
            result: {
              id: environment.RELEASE_HYPERDRIVE_ID,
              origin: { host, database: "lovechapter", user: "app" },
              caching: { disabled: true },
            },
          }),
          { status: 200 },
        ),
  );
  let mode = "maintenance";
  let targetSha = sha;
  let activeCount = 0;
  let changedAt = closedAt;
  let revisionMatches = true;
  let ledgerMatches = true;
  const query = vi.fn(async (statement: string) => {
    if (statement.includes("from ops.release_control")) {
      return {
        rows: [
          {
            mode,
            target_sha: targetSha,
            changed_at: changedAt,
            web_version_id: null,
            web_source_sha: null,
            api_version_id: null,
            api_source_sha: null,
          },
        ],
        rowCount: 1,
      };
    }
    if (statement.includes("count(*)")) {
      return { rows: [{ count: String(activeCount) }], rowCount: 1 };
    }
    if (statement.includes("from ops.release_leases")) {
      return { rows: [], rowCount: 0 };
    }
    if (statement.includes("from drizzle.__drizzle_migrations")) {
      if (statement.includes("order by created_at")) {
        const rows = ledgerMatches
          ? ledger
          : [
              ...ledger.slice(0, -1),
              { hash: "drifted-hash", created_at: String(previous.when) },
            ];
        return { rows, rowCount: rows.length };
      }
      return {
        rows: revisionMatches ? [{ one: 1 }] : [],
        rowCount: revisionMatches ? 1 : 0,
      };
    }
    throw new Error("Unexpected SQL");
  });
  const connect = vi.fn(async () => undefined);
  const end = vi.fn(async () => undefined);
  const client = { connect, end, query } as unknown as Client;
  const createClient = vi.fn(() => client);
  const migrateDatabase = vi.fn(async (): Promise<void> => {});
  const output: string[] = [];
  return {
    environment,
    fetcher,
    createClient,
    connect,
    end,
    query,
    migrateDatabase,
    output,
    write: (line: string) => output.push(line),
    change: (value: {
      mode?: string;
      targetSha?: string;
      activeCount?: number;
      changedAt?: string;
      revisionMatches?: boolean;
      ledgerMatches?: boolean;
    }) => {
      mode = value.mode ?? mode;
      targetSha = value.targetSha ?? targetSha;
      activeCount = value.activeCount ?? activeCount;
      changedAt = value.changedAt ?? changedAt;
      revisionMatches = value.revisionMatches ?? revisionMatches;
      ledgerMatches = value.ledgerMatches ?? ledgerMatches;
    },
  };
}

describe("release migration CLI", () => {
  it("migrates only a verified direct role while the exact closure is drained", async () => {
    const context = fixture();
    await runReleaseMigrationCli(args, context.environment, context);
    expect(context.createClient).toHaveBeenCalledWith(
      context.environment.RELEASE_MIGRATION_DATABASE_URL,
    );
    expect(context.migrateDatabase).toHaveBeenCalledOnce();
    expect(context.end).toHaveBeenCalledOnce();
    expect(context.output).toEqual([
      JSON.stringify({ status: "applied_and_validated" }),
    ]);
    expect(context.output.join(" ")).not.toMatch(/password|secret/u);
  });

  it("rejects wrong branch, app role, or pooled URL before connecting", async () => {
    for (const edit of [
      { RELEASE_NEON_BRANCH_ID: "br-other" },
      { RELEASE_MIGRATION_DATABASE_ROLE: "app" },
      { RELEASE_MIGRATION_DATABASE_ROLE: "other" },
      {
        RELEASE_MIGRATION_DATABASE_URL: `postgresql://migrator:migration-password@ep-staging-pooler.ap-southeast-1.aws.neon.tech/lovechapter?sslmode=require`,
      },
    ]) {
      const context = fixture();
      await expect(
        runReleaseMigrationCli(
          args,
          { ...context.environment, ...edit },
          context,
        ),
      ).rejects.toThrow();
      expect(context.createClient).not.toHaveBeenCalled();
    }
  });

  it("refuses an open, stale, or leased gate before applying a migration", async () => {
    for (const edit of [
      { mode: "open" },
      { targetSha: "b".repeat(40) },
      { activeCount: 1 },
      { changedAt: "2026-09-26 06:01:00+00" },
    ]) {
      const context = fixture();
      context.change(edit);
      await expect(
        runReleaseMigrationCli(args, context.environment, context),
      ).rejects.toThrow();
      expect(context.migrateDatabase).not.toHaveBeenCalled();
      expect(context.end).toHaveBeenCalledOnce();
    }
  });

  it("refuses a schema revision mismatch or a gate that changed during migration", async () => {
    for (const edit of [
      { revisionMatches: false },
      { mode: "open" },
      { targetSha: "b".repeat(40) },
    ]) {
      const context = fixture();
      context.migrateDatabase.mockImplementationOnce(async () =>
        context.change(edit),
      );
      await expect(
        runReleaseMigrationCli(args, context.environment, context),
      ).rejects.toThrow();
      expect(context.output).toEqual([]);
      expect(context.end).toHaveBeenCalledOnce();
    }
  });

  it("rejects drift or an unreviewed pending migration before mutating schema", async () => {
    const context = fixture();
    context.change({ ledgerMatches: false });
    await expect(
      runReleaseMigrationCli(args, context.environment, context),
    ).rejects.toThrow();
    expect(context.migrateDatabase).not.toHaveBeenCalled();

    const another = fixture();
    await expect(
      runReleaseMigrationCli(
        [
          "--sha",
          sha,
          "--closed-at",
          closedAt,
          "--reviewed",
          "packages/database/drizzle/0009_release_control.sql",
        ],
        another.environment,
        another,
      ),
    ).rejects.toThrow();
    expect(another.migrateDatabase).not.toHaveBeenCalled();
  });
});
