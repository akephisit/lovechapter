import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import type { Client } from "pg";
import { describe, expect, it, vi } from "vitest";

import { runStagingBootstrapGateCli } from "./staging-bootstrap-cli";

const sha = "a".repeat(40);
const closedAt = "2026-09-27 06:00:00+00";
const host = "ep-staging.ap-southeast-1.aws.neon.tech";
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

function fixture() {
  let mode = "open";
  let targetSha: string | null = null;
  let activeCount = 0;
  let changedAt = "2026-09-27 05:00:00+00";
  let hasVersionColumns = false;
  let ledgerRows = ledger;
  const environment = {
    RELEASE_ENVIRONMENT: "staging",
    RELEASE_DATABASE_URL: `postgresql://release:gate-password@${host}/lovechapter?sslmode=require`,
    RELEASE_DATABASE_ROLE: "release",
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
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql.includes("information_schema.columns")) {
      return {
        rows: hasVersionColumns ? [{ column_name: "web_version_id" }] : [],
      };
    }
    if (sql.includes("from drizzle.__drizzle_migrations")) {
      return { rows: ledgerRows, rowCount: ledgerRows.length };
    }
    if (sql.includes("update ops.release_control")) {
      if (mode !== "open") return { rows: [], rowCount: 0 };
      mode = "maintenance";
      targetSha = String(params?.[0]);
      changedAt = closedAt;
      return { rows: [{ changed_at: closedAt }], rowCount: 1 };
    }
    if (sql.includes("from ops.release_control")) {
      return {
        rows: [{ mode, target_sha: targetSha, changed_at: changedAt }],
        rowCount: 1,
      };
    }
    if (sql.includes("count(*)")) {
      return { rows: [{ count: String(activeCount) }], rowCount: 1 };
    }
    if (sql.includes("from ops.release_leases")) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error("Unexpected SQL");
  });
  const connect = vi.fn(async () => undefined);
  const end = vi.fn(async () => undefined);
  const createClient = vi.fn(
    () => ({ connect, end, query }) as unknown as Client,
  );
  const output: string[] = [];
  return {
    environment,
    fetcher,
    createClient,
    connect,
    end,
    query,
    output,
    write: (line: string) => output.push(line),
    setActiveCount: (count: number) => {
      activeCount = count;
    },
    setVersionColumns: (present: boolean) => {
      hasVersionColumns = present;
    },
    setLedgerRows: (rows: typeof ledger) => {
      ledgerRows = rows;
    },
    state: () => ({ mode, targetSha, changedAt }),
  };
}

describe("one-time staging gate CLI", () => {
  it("reads only pre-schema status and closes once", async () => {
    const context = fixture();
    await runStagingBootstrapGateCli(["status"], context.environment, context);
    expect(JSON.parse(context.output.at(-1)!)).toMatchObject({
      mode: "open",
      activeCount: 0,
    });
    await runStagingBootstrapGateCli(
      ["close", "--sha", sha],
      context.environment,
      context,
    );
    expect(context.state()).toEqual({
      mode: "maintenance",
      targetSha: sha,
      changedAt: closedAt,
    });
    expect(JSON.parse(context.output.at(-1)!)).toMatchObject({
      mode: "maintenance",
      targetSha: sha,
      changedAt: closedAt,
    });
    await expect(
      runStagingBootstrapGateCli(
        ["close", "--sha", sha],
        context.environment,
        context,
      ),
    ).rejects.toThrow();
    expect(context.state().changedAt).toBe(closedAt);
    expect(
      context.query.mock.calls
        .map(([sql]) => sql)
        .filter((sql) => sql.includes("from ops.release_control"))
        .join("\n"),
    ).not.toMatch(/(?:web|api)_(?:version_id|source_sha)/u);
  });

  it("drains only the original closure and rejects mismatched timestamps", async () => {
    const context = fixture();
    await runStagingBootstrapGateCli(
      ["close", "--sha", sha],
      context.environment,
      context,
    );
    await runStagingBootstrapGateCli(
      ["drain", "--sha", sha, "--closed-at", closedAt],
      context.environment,
      context,
    );
    expect(JSON.parse(context.output.at(-1)!)).toMatchObject({
      activeCount: 0,
      changedAt: closedAt,
    });
    await expect(
      runStagingBootstrapGateCli(
        ["drain", "--sha", sha, "--closed-at", "2026-09-27 06:01:00+00"],
        context.environment,
        context,
      ),
    ).rejects.toThrow();
  });

  it("rejects wrong environment, target, pooled URL, and invalid arguments before connecting", async () => {
    for (const edit of [
      { RELEASE_ENVIRONMENT: "production" },
      { RELEASE_NEON_BRANCH_ID: "br-wrong" },
      { RELEASE_DATABASE_ROLE: "app" },
      {
        RELEASE_DATABASE_URL: `postgresql://release:gate-password@ep-staging-pooler.ap-southeast-1.aws.neon.tech/lovechapter?sslmode=require`,
      },
    ]) {
      const context = fixture();
      await expect(
        runStagingBootstrapGateCli(
          ["status"],
          { ...context.environment, ...edit },
          context,
        ),
      ).rejects.toThrow();
      expect(context.createClient).not.toHaveBeenCalled();
    }
    for (const args of [
      ["open"],
      ["close", "--sha", "short"],
      ["status", "--sha", sha],
      ["drain", "--sha", sha],
      ["close", "--sha", sha, "--sha", sha],
    ]) {
      const context = fixture();
      await expect(
        runStagingBootstrapGateCli(args, context.environment, context),
      ).rejects.toThrow();
      expect(context.createClient).not.toHaveBeenCalled();
    }
  });

  it("never leaks provider bodies or credentials in errors", async () => {
    const context = fixture();
    const fetcher = vi.fn(
      async () =>
        new Response("gate-password neon-test-secret", { status: 503 }),
    );
    await expect(
      runStagingBootstrapGateCli(["status"], context.environment, {
        ...context,
        fetcher,
      }),
    ).rejects.toThrow(/^Staging bootstrap gate failed$/u);
    expect(context.createClient).not.toHaveBeenCalled();
  });

  it("refuses a post-0010 or drifted schema before closing", async () => {
    for (const corrupt of [
      (context: ReturnType<typeof fixture>) => context.setVersionColumns(true),
      (context: ReturnType<typeof fixture>) =>
        context.setLedgerRows(ledger.slice(0, -1)),
    ]) {
      const context = fixture();
      corrupt(context);
      await expect(
        runStagingBootstrapGateCli(
          ["close", "--sha", sha],
          context.environment,
          context,
        ),
      ).rejects.toThrow();
      expect(context.state().mode).toBe("open");
      expect(context.query.mock.calls.flat().join("\n")).not.toMatch(
        /update ops.release_control/u,
      );
    }
  });
});
