import { describe, expect, it, vi } from "vitest";

import { runQueryPlanProbe } from "./staging-query-plan-probe.mjs";

const testDatabaseUrl =
  "postgresql://qa:password@ep-test.neon.tech/neondb?sslmode=require";
const input = {
  testDatabaseUrl,
  activeStagingHost: "ep-stage.neon.tech",
  productionHost: "ep-prod.neon.tech",
  expectedTestBranchId: "br-test",
  confirm: "lovechapter_test",
};
const indexes = [
  null,
  "guests_pkey",
  "invitations_token_hash_unique",
  "auth_accounts_email_key_unique",
  "auth_sessions_token_hash_unique",
  "auth_email_jobs_due_idx",
  "auth_rate_limits_expiry_cleanup_idx",
];

function harness({ missingIndex = -1, rollbackFails = false } = {}) {
  const queries = [];
  let explain = 0;
  const client = {
    connect: vi.fn(async () => undefined),
    end: vi.fn(async () => undefined),
    query: vi.fn(async (sql, params) => {
      queries.push({ sql, params });
      if (sql === "rollback" && rollbackFails)
        throw new Error("rollback failed");
      if (sql.startsWith("select id from guests")) {
        return { rows: [{ id: "11111111-1111-4111-8111-111111111111" }] };
      }
      if (sql.startsWith("select id from auth_accounts")) {
        return { rows: [{ id: "22222222-2222-4222-8222-222222222222" }] };
      }
      if (sql.startsWith("explain")) {
        const index = explain === missingIndex ? null : indexes[explain];
        explain += 1;
        return {
          rows: [
            {
              "QUERY PLAN": [
                {
                  "Execution Time": 1,
                  Plan: {
                    "Node Type": "Limit",
                    "Actual Rows": 1,
                    "Shared Hit Blocks": 1,
                    "Shared Read Blocks": 0,
                    Plans: [
                      {
                        "Node Type": index ? "Index Scan" : "Seq Scan",
                        ...(index ? { "Index Name": index } : {}),
                      },
                    ],
                  },
                },
              ],
            },
          ],
        };
      }
      return { rows: [] };
    }),
  };
  return {
    client,
    queries,
    clientFactory: vi.fn(() => client),
    neonInventory: vi.fn(async () => ({
      endpoints: [
        { branch_id: "br-test", host: "ep-test.neon.tech", type: "read_write" },
      ],
    })),
  };
}

describe("disposable staging query-plan probe", () => {
  it("checks seven bounded SELECT plans and rolls the representative seed back", async () => {
    const context = harness();
    const report = await runQueryPlanProbe(
      input,
      context.clientFactory,
      context.neonInventory,
    );
    expect(report.commitment).toBe("disposable_branch_only");
    expect(report.plans).toHaveLength(7);
    expect(
      context.queries.filter(({ sql }) => sql.startsWith("explain")),
    ).toHaveLength(7);
    expect(
      context.queries
        .filter(({ sql }) => sql.startsWith("explain"))
        .every(({ sql }) =>
          /^explain \(analyze, buffers, format json\) (select|with)\b/iu.test(
            sql,
          ),
        ),
    ).toBe(true);
    expect(context.queries.at(-1).sql).toBe("rollback");
    expect(context.client.end).toHaveBeenCalledOnce();
    expect(JSON.stringify(report)).not.toContain("password");
  });

  it("rejects wrong branch, same host, production host, and missing confirmation before connection", async () => {
    for (const override of [
      { activeStagingHost: "ep-test.neon.tech" },
      { productionHost: "ep-test.neon.tech" },
      { expectedTestBranchId: "br-wrong" },
      { confirm: "" },
      { testDatabaseUrl: `${testDatabaseUrl}&host=ep-stage.neon.tech` },
    ]) {
      const context = harness();
      await expect(
        runQueryPlanProbe(
          { ...input, ...override },
          context.clientFactory,
          context.neonInventory,
        ),
      ).rejects.toThrow();
      expect(context.clientFactory).not.toHaveBeenCalled();
    }
  });

  it("permits staging-only rehearsal before a production database exists", async () => {
    const context = harness();
    await expect(
      runQueryPlanProbe(
        { ...input, productionHost: undefined },
        context.clientFactory,
        context.neonInventory,
      ),
    ).resolves.toMatchObject({ commitment: "disposable_branch_only" });
  });

  it("rejects absent critical index and a failed rollback", async () => {
    for (const option of [{ missingIndex: 2 }, { rollbackFails: true }]) {
      const context = harness(option);
      await expect(
        runQueryPlanProbe(input, context.clientFactory, context.neonInventory),
      ).rejects.toThrow();
      expect(context.queries.some(({ sql }) => sql === "rollback")).toBe(true);
      expect(context.client.end).toHaveBeenCalledOnce();
    }
  });
});
