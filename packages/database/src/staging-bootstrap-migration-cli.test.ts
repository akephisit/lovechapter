import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import type { Client } from "pg";
import { describe, expect, it, vi } from "vitest";

import { runStagingBootstrapMigrationCli } from "./staging-bootstrap-migration-cli";

const sha = "a".repeat(40);
const closedAt = "2026-09-27 06:00:00+00";
const lsn = "0/1DE2850";
const host = "ep-staging.ap-southeast-1.aws.neon.tech";
const checkpointHost = "ep-checkpoint.ap-southeast-1.aws.neon.tech";
const args = [
  "--sha",
  sha,
  "--closed-at",
  closedAt,
  "--checkpoint-branch-id",
  "br-checkpoint-456",
  "--checkpoint-lsn",
  lsn,
];
const journal = JSON.parse(
  readFileSync(
    new URL("../drizzle/meta/_journal.json", import.meta.url),
    "utf8",
  ),
) as { entries: Array<{ tag: string; when: number }> };
const ledger = journal.entries.slice(0, -1).map((entry) => ({
  hash: createHash("sha256")
    .update(
      readFileSync(new URL(`../drizzle/${entry.tag}.sql`, import.meta.url)),
    )
    .digest("hex"),
  created_at: String(entry.when),
}));
const retained = {
  users: "1",
  weddings: "1",
  guests: "2",
  invitations: "2",
  rsvps: "1",
  authAccounts: "1",
  authEmailJobs: "0",
};

function fixture() {
  const environment = {
    RELEASE_ENVIRONMENT: "staging",
    RELEASE_DATABASE_URL: `postgresql://release:gate-password@${host}/lovechapter?sslmode=require`,
    RELEASE_DATABASE_ROLE: "release",
    RELEASE_MIGRATION_DATABASE_URL: `postgresql://migrator:migration-password@${host}/lovechapter?sslmode=require`,
    RELEASE_MIGRATION_DATABASE_ROLE: "migrator",
    RELEASE_CHECKPOINT_DATABASE_URL: `postgresql://checkpoint:checkpoint-password@${checkpointHost}/lovechapter?sslmode=require`,
    RELEASE_CHECKPOINT_DATABASE_ROLE: "checkpoint",
    RELEASE_APP_DATABASE_ROLE: "app",
    RELEASE_NEON_PROJECT_ID: "icy-hat-79862899",
    RELEASE_NEON_BRANCH_ID: "br-staging-123",
    RELEASE_DATABASE_NAME: "lovechapter",
    RELEASE_CLOUDFLARE_ACCOUNT_ID: "cf-account-123",
    RELEASE_HYPERDRIVE_ID: "staging-hyperdrive-123",
    RELEASE_NEON_API_KEY: "neon-test-secret",
    RELEASE_CLOUDFLARE_API_TOKEN: "cf-test-secret",
  };
  let parentId = environment.RELEASE_NEON_BRANCH_ID;
  let checkpointProjectId = environment.RELEASE_NEON_PROJECT_ID;
  let parentLsn = lsn;
  let initSource = "parent-data";
  let endpointHost = checkpointHost;
  let mode = "maintenance";
  let changedAt = closedAt;
  let activeCount = 0;
  let ledgerRows = ledger;
  let checkpointMarkers = retained;
  let checkpointMode = "maintenance";
  let checkpointChangedAt = closedAt;
  let checkpointHasVersions = false;
  let migrated = false;
  let revisionMatches = true;
  let constraintMatches = true;
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/branches/br-checkpoint-456")) {
      return new Response(
        JSON.stringify({
          branch: {
            id: "br-checkpoint-456",
            project_id: checkpointProjectId,
            parent_id: parentId,
            parent_lsn: parentLsn,
            init_source: initSource,
          },
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/branches/br-checkpoint-456/endpoints")) {
      return new Response(
        JSON.stringify({
          endpoints: [
            {
              branch_id: "br-checkpoint-456",
              host: endpointHost,
              type: "read_write",
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (url.startsWith("https://console.neon.tech/")) {
      return new Response(
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
      );
    }
    return new Response(
      JSON.stringify({
        success: true,
        result: {
          id: environment.RELEASE_HYPERDRIVE_ID,
          origin: { host, database: "lovechapter", user: "app" },
          caching: { disabled: true },
        },
      }),
      { status: 200 },
    );
  });
  const activeQuery = vi.fn(async (sql: string) => {
    if (sql.includes("from ops.release_control")) {
      return {
        rows: [
          {
            mode,
            target_sha: sha,
            changed_at: changedAt,
            ...(migrated
              ? {
                  web_version_id: null,
                  web_source_sha: null,
                  api_version_id: null,
                  api_source_sha: null,
                }
              : {}),
          },
        ],
        rowCount: 1,
      };
    }
    if (sql.includes("from ops.release_leases") && sql.includes("count(*)")) {
      return { rows: [{ count: String(activeCount) }], rowCount: 1 };
    }
    if (sql.includes("from ops.release_leases")) {
      return { rows: [], rowCount: 0 };
    }
    if (sql.includes("from drizzle.__drizzle_migrations")) {
      if (sql.includes("order by created_at")) {
        return { rows: ledgerRows, rowCount: ledgerRows.length };
      }
      return {
        rows: revisionMatches ? [{ one: 1 }] : [],
        rowCount: revisionMatches ? 1 : 0,
      };
    }
    if (sql.includes("information_schema.columns")) {
      return {
        rows: migrated
          ? [
              { column_name: "web_version_id" },
              { column_name: "web_source_sha" },
              { column_name: "api_version_id" },
              { column_name: "api_source_sha" },
            ]
          : [],
      };
    }
    if (sql.includes("from pg_constraint")) {
      return { rows: constraintMatches && migrated ? [{ one: 1 }] : [] };
    }
    if (sql.includes("from users") && sql.includes("auth_email_jobs")) {
      return { rows: [retained] };
    }
    throw new Error("Unexpected active SQL");
  });
  const checkpointQuery = vi.fn(async (sql: string) => {
    if (sql.includes("information_schema.columns")) {
      return {
        rows: checkpointHasVersions ? [{ column_name: "web_version_id" }] : [],
      };
    }
    if (sql.includes("from ops.release_control")) {
      return {
        rows: [
          {
            mode: checkpointMode,
            target_sha: sha,
            changed_at: checkpointChangedAt,
          },
        ],
      };
    }
    if (sql.includes("from ops.release_leases") && sql.includes("count(*)")) {
      return { rows: [{ count: "0" }] };
    }
    if (sql.includes("from ops.release_leases")) {
      return { rows: [] };
    }
    if (sql.includes("from users") && sql.includes("auth_email_jobs")) {
      return { rows: [checkpointMarkers] };
    }
    if (sql.includes("from drizzle.__drizzle_migrations")) {
      return { rows: ledger, rowCount: ledger.length };
    }
    throw new Error("Unexpected checkpoint SQL");
  });
  const connect = vi.fn(async () => undefined);
  const end = vi.fn(async () => undefined);
  const active = { connect, end, query: activeQuery } as unknown as Client;
  const checkpoint = {
    connect,
    end,
    query: checkpointQuery,
  } as unknown as Client;
  const createClient = vi.fn((url: string) =>
    url.includes(checkpointHost) ? checkpoint : active,
  );
  const migrateDatabase = vi.fn(async () => {
    migrated = true;
    ledgerRows = [...ledger, { hash: "current", created_at: "9999999999999" }];
  });
  const output: string[] = [];
  return {
    environment,
    fetcher,
    createClient,
    activeQuery,
    checkpointQuery,
    migrateDatabase,
    output,
    write: (line: string) => output.push(line),
    change: (value: {
      parentId?: string;
      checkpointProjectId?: string;
      parentLsn?: string;
      initSource?: string;
      endpointHost?: string;
      mode?: string;
      changedAt?: string;
      activeCount?: number;
      ledgerRows?: typeof ledger;
      checkpointMarkers?: typeof retained;
      checkpointMode?: string;
      checkpointChangedAt?: string;
      checkpointHasVersions?: boolean;
      revisionMatches?: boolean;
      constraintMatches?: boolean;
      migrated?: boolean;
    }) => {
      parentId = value.parentId ?? parentId;
      checkpointProjectId = value.checkpointProjectId ?? checkpointProjectId;
      parentLsn = value.parentLsn ?? parentLsn;
      initSource = value.initSource ?? initSource;
      endpointHost = value.endpointHost ?? endpointHost;
      mode = value.mode ?? mode;
      changedAt = value.changedAt ?? changedAt;
      activeCount = value.activeCount ?? activeCount;
      ledgerRows = value.ledgerRows ?? ledgerRows;
      checkpointMarkers = value.checkpointMarkers ?? checkpointMarkers;
      checkpointMode = value.checkpointMode ?? checkpointMode;
      checkpointChangedAt = value.checkpointChangedAt ?? checkpointChangedAt;
      checkpointHasVersions =
        value.checkpointHasVersions ?? checkpointHasVersions;
      revisionMatches = value.revisionMatches ?? revisionMatches;
      constraintMatches = value.constraintMatches ?? constraintMatches;
      migrated = value.migrated ?? migrated;
    },
  };
}

describe("one-time staging migration CLI", () => {
  it("requires a provider-verified, readable checkpoint before applying only 0011", async () => {
    const context = fixture();
    await runStagingBootstrapMigrationCli(args, context.environment, context);
    expect(context.migrateDatabase).toHaveBeenCalledOnce();
    expect(context.createClient).toHaveBeenCalledWith(
      context.environment.RELEASE_MIGRATION_DATABASE_URL,
    );
    expect(context.createClient).toHaveBeenCalledWith(
      context.environment.RELEASE_CHECKPOINT_DATABASE_URL,
    );
    expect(context.output).toEqual([
      JSON.stringify({
        status: "applied_and_validated",
        checkpointBranchId: "br-checkpoint-456",
      }),
    ]);
    expect(context.output.join(" ")).not.toMatch(
      /password|secret|postgresql:/u,
    );
  });

  it("rejects missing, wrong, schema-only, or inaccessible checkpoints before migration", async () => {
    for (const change of [
      { parentId: "br-other" },
      { checkpointProjectId: "other-project" },
      { parentLsn: "0/FFFF" },
      { initSource: "parent-schema" },
      { endpointHost: "ep-other.neon.tech" },
      { checkpointMarkers: { ...retained, guests: "0" } },
      { checkpointMode: "open" },
      { checkpointChangedAt: "2026-09-27 05:00:00+00" },
      { checkpointHasVersions: true },
    ]) {
      const context = fixture();
      context.change(change);
      await expect(
        runStagingBootstrapMigrationCli(args, context.environment, context),
      ).rejects.toThrow();
      expect(context.migrateDatabase).not.toHaveBeenCalled();
    }
    const context = fixture();
    await expect(
      runStagingBootstrapMigrationCli(
        args,
        { ...context.environment, RELEASE_CHECKPOINT_DATABASE_URL: undefined },
        context,
      ),
    ).rejects.toThrow();
    expect(context.migrateDatabase).not.toHaveBeenCalled();
  });

  it("refuses a checkpoint database that cannot be opened", async () => {
    const context = fixture();
    context.createClient.mockImplementationOnce(
      () =>
        ({
          connect: async () => {
            throw new Error("checkpoint-password connection failure");
          },
          end: async () => undefined,
        }) as unknown as Client,
    );
    await expect(
      runStagingBootstrapMigrationCli(args, context.environment, context),
    ).rejects.toThrow(/^Staging bootstrap migration failed$/u);
    expect(context.migrateDatabase).not.toHaveBeenCalled();
  });

  it("rejects production, target mismatch, pooled or same-role URL before connecting", async () => {
    for (const edit of [
      { RELEASE_ENVIRONMENT: "production" },
      { RELEASE_NEON_BRANCH_ID: "br-other" },
      { RELEASE_DATABASE_ROLE: "other" },
      {
        RELEASE_DATABASE_URL: `postgresql://release:gate-password@ep-other.ap-southeast-1.aws.neon.tech/lovechapter?sslmode=require`,
      },
      { RELEASE_MIGRATION_DATABASE_ROLE: "app" },
      { RELEASE_MIGRATION_DATABASE_ROLE: "release" },
      {
        RELEASE_MIGRATION_DATABASE_URL: `postgresql://migrator:migration-password@ep-staging-pooler.ap-southeast-1.aws.neon.tech/lovechapter?sslmode=require`,
      },
    ]) {
      const context = fixture();
      await expect(
        runStagingBootstrapMigrationCli(
          args,
          { ...context.environment, ...edit },
          context,
        ),
      ).rejects.toThrow();
      expect(context.createClient).not.toHaveBeenCalled();
      expect(context.migrateDatabase).not.toHaveBeenCalled();
    }
  });

  it("rejects changed closure, active leases, wrong ledger, or already-applied 0011", async () => {
    for (const change of [
      { mode: "open" },
      { changedAt: "2026-09-27 06:01:00+00" },
      { activeCount: 1 },
      { ledgerRows: ledger.slice(0, -1) },
      {
        ledgerRows: [
          ...ledger.slice(0, -1),
          { ...ledger.at(-1)!, hash: "drift" },
        ],
      },
      { migrated: true },
    ]) {
      const context = fixture();
      context.change(change);
      await expect(
        runStagingBootstrapMigrationCli(args, context.environment, context),
      ).rejects.toThrow();
      expect(context.migrateDatabase).not.toHaveBeenCalled();
    }
  });

  it("does not report success when post-migration revision, columns, or closure fail", async () => {
    for (const change of [
      { revisionMatches: false },
      { constraintMatches: false },
    ]) {
      const context = fixture();
      context.change(change);
      await expect(
        runStagingBootstrapMigrationCli(args, context.environment, context),
      ).rejects.toThrow();
      expect(context.output).toEqual([]);
    }
    const context = fixture();
    context.migrateDatabase.mockImplementationOnce(async () => {
      context.change({ migrated: true, mode: "open" });
    });
    await expect(
      runStagingBootstrapMigrationCli(args, context.environment, context),
    ).rejects.toThrow();
    expect(context.output).toEqual([]);
  });

  it("sanitizes provider failures and forbids extra arguments", async () => {
    const context = fixture();
    await expect(
      runStagingBootstrapMigrationCli(args, context.environment, {
        ...context,
        fetcher: vi.fn(
          async () =>
            new Response("neon-test-secret migration-password", {
              status: 503,
            }),
        ),
      }),
    ).rejects.toThrow(/^Staging bootstrap migration failed$/u);
    expect(context.createClient).not.toHaveBeenCalled();
    await expect(
      runStagingBootstrapMigrationCli(
        [...args, "--extra", "value"],
        context.environment,
        context,
      ),
    ).rejects.toThrow();
  });
});
