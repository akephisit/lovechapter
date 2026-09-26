import { describe, expect, it, vi } from "vitest";

import { expectedSchemaMigrationHash } from "../packages/database/src/schema-revision.ts";
import { runStagingAcceptanceCli } from "./staging-acceptance-cli.mjs";

const sha = "a".repeat(40);
const host = "ep-staging.ap-southeast-1.aws.neon.tech";
const planNames = [
  "wedding-list",
  "guest-list",
  "invitation-lookup",
  "auth-email-lookup",
  "session-lookup",
  "due-email-jobs",
  "rate-limit-cleanup",
];

function fixture() {
  const env = {
    GITHUB_ACTIONS: "true",
    GITHUB_SHA: sha,
    RELEASE_ENVIRONMENT: "staging",
    RELEASE_POSTGRES_JOB_RESULT: "success",
    RELEASE_DATABASE_URL: `postgresql://release:private-password@${host}/lovechapter?sslmode=require`,
    RELEASE_DATABASE_ROLE: "release",
    RELEASE_APP_DATABASE_ROLE: "app",
    RELEASE_NEON_PROJECT_ID: "icy-hat-79862899",
    RELEASE_NEON_BRANCH_ID: "br-staging-123",
    RELEASE_DATABASE_NAME: "lovechapter",
    RELEASE_CLOUDFLARE_ACCOUNT_ID: "cf-account-123",
    RELEASE_HYPERDRIVE_ID: "staging-hyperdrive-123",
    RELEASE_NEON_API_KEY: "neon-test-secret",
    RELEASE_CLOUDFLARE_API_TOKEN: "cf-test-secret",
    RELEASE_WEB_ORIGIN: "https://lovechapter-web-staging.example.workers.dev",
    RELEASE_TEST_EMAIL: "verified@example.test",
    RELEASE_TEST_PASSWORD: "private-test-password",
    RELEASE_VERIFICATION_EMAIL: "verify@example.test",
    RELEASE_FOREIGN_WEDDING_ID: "22222222-2222-4222-8222-222222222222",
    RELEASE_TEST_DATABASE_URL:
      "postgresql://tester:test-password@ep-test.ap-southeast-1.aws.neon.tech/lovechapter?sslmode=require",
    RELEASE_TEST_BRANCH_ID: "br-test-456",
    RELEASE_TEST_DATABASE_CONFIRM: "lovechapter_test",
  };
  const fetcher = vi.fn(async (input) =>
    String(input).startsWith("https://console.neon.tech/")
      ? new globalThis.Response(
          JSON.stringify({
            endpoints: [
              {
                branch_id: String(input).includes("/branches/br-test-456/")
                  ? "br-test-456"
                  : env.RELEASE_NEON_BRANCH_ID,
                host: String(input).includes("/branches/br-test-456/")
                  ? "ep-test.ap-southeast-1.aws.neon.tech"
                  : host,
                type: "read_write",
              },
            ],
          }),
          { status: 200 },
        )
      : new globalThis.Response(
          JSON.stringify({
            success: true,
            result: {
              id: env.RELEASE_HYPERDRIVE_ID,
              origin: { host, database: "lovechapter", user: "app" },
              caching: { disabled: true },
            },
          }),
          { status: 200 },
        ),
  );
  const connect = vi.fn(async () => undefined);
  const end = vi.fn(async () => undefined);
  const client = { connect, end, query: vi.fn() };
  const testConnect = vi.fn(async () => undefined);
  const testEnd = vi.fn(async () => undefined);
  const testQuery = vi.fn(async () => ({
    rows: [{ hash: expectedSchemaMigrationHash }],
  }));
  const testClient = { connect: testConnect, end: testEnd, query: testQuery };
  const createClient = vi.fn((url) =>
    url === env.RELEASE_TEST_DATABASE_URL ? testClient : client,
  );
  const gate = {
    mode: "open",
    targetSha: sha,
    activeCount: 0,
  };
  const readGateStatus = vi.fn(async () => gate);
  const http = vi.fn(async () => ({
    commitSha: sha,
    checks: [
      "verification_outbox",
      "reset_outbox",
      "verified_session",
      "tenant_isolation",
      "guest_rsvp",
      "csv_round_trip",
      "session_revoked",
      "scoped_cleanup",
    ],
    inboxDelivery: "waived",
  }));
  const jobs = vi.fn(async () => ({
    commitSha: sha,
    checks: ["scheduled_email_provider", "scheduled_cleanup"],
    inboxDelivery: "waived",
    providerRetry: "isolated_postgres_required",
  }));
  const plans = vi.fn(async () => ({
    commitment: "disposable_branch_only",
    plans: planNames.map((name) => ({ name })),
  }));
  const output = [];
  return {
    env,
    fetcher,
    client,
    createClient,
    connect,
    end,
    testConnect,
    testEnd,
    testQuery,
    readGateStatus,
    http,
    jobs,
    plans,
    output,
    write: (line) => output.push(line),
  };
}

describe("live staging acceptance CLI boundary", () => {
  it("preflights branch identity and current schema before connecting to staging", async () => {
    const context = fixture();
    await expect(
      runStagingAcceptanceCli(sha, context.env, {
        ...context,
        preflightOnly: true,
      }),
    ).resolves.toEqual({ targetVerified: true });
    expect(context.fetcher).toHaveBeenCalledTimes(3);
    expect(context.createClient).toHaveBeenCalledExactlyOnceWith(
      context.env.RELEASE_TEST_DATABASE_URL,
    );
    expect(context.testQuery).toHaveBeenCalledWith(
      expect.stringContaining("drizzle.__drizzle_migrations"),
    );
    expect(context.testEnd).toHaveBeenCalledOnce();
    expect(context.connect).not.toHaveBeenCalled();
    expect(context.http).not.toHaveBeenCalled();
    expect(context.output).toEqual([JSON.stringify({ targetVerified: true })]);
  });

  it("verifies target and open SHA before probes, then rechecks before output", async () => {
    const context = fixture();
    const result = await runStagingAcceptanceCli(sha, context.env, context);
    expect(context.createClient).toHaveBeenCalledWith(
      context.env.RELEASE_DATABASE_URL,
    );
    expect(context.http).toHaveBeenCalledOnce();
    expect(context.jobs).toHaveBeenCalledOnce();
    expect(context.plans).toHaveBeenCalledOnce();
    expect(context.readGateStatus).toHaveBeenCalledTimes(2);
    expect(context.end).toHaveBeenCalledOnce();
    expect(context.testEnd).toHaveBeenCalledOnce();
    expect(result.commitSha).toBe(sha);
    expect(context.output).toEqual([JSON.stringify(result)]);
    expect(context.output.join(" ")).not.toMatch(
      /private-password|test-password|neon-test-secret/u,
    );
  });

  it("rejects a stale or missing test schema before staging acceptance", async () => {
    for (const rows of [[], [{ hash: "stale-schema" }]]) {
      const context = fixture();
      context.testQuery.mockResolvedValueOnce({ rows });
      await expect(
        runStagingAcceptanceCli(sha, context.env, {
          ...context,
          preflightOnly: true,
        }),
      ).rejects.toThrow();
      expect(context.connect).not.toHaveBeenCalled();
      expect(context.testEnd).toHaveBeenCalledOnce();
      expect(context.output).toEqual([]);
    }
  });

  it("rejects invalid CI evidence or wrong provider target before connecting", async () => {
    for (const edit of [
      { RELEASE_POSTGRES_JOB_RESULT: "skipped" },
      { GITHUB_SHA: "b".repeat(40) },
      { RELEASE_NEON_BRANCH_ID: "br-other" },
      { RELEASE_APP_DATABASE_ROLE: "release" },
      { RELEASE_TEST_BRANCH_ID: "br-other" },
      {
        RELEASE_TEST_DATABASE_URL:
          "postgresql://tester:test-password@ep-wrong.ap-southeast-1.aws.neon.tech/lovechapter?sslmode=require",
      },
    ]) {
      const context = fixture();
      await expect(
        runStagingAcceptanceCli(sha, { ...context.env, ...edit }, context),
      ).rejects.toThrow();
      expect(context.createClient).not.toHaveBeenCalled();
      expect(context.output).toEqual([]);
    }
  });

  it("rejects a gate that changed before or during acceptance", async () => {
    for (const changeOnRead of [1, 2]) {
      const context = fixture();
      context.readGateStatus.mockImplementation(async () =>
        context.readGateStatus.mock.calls.length === changeOnRead
          ? { mode: "maintenance", targetSha: sha, activeCount: 0 }
          : { mode: "open", targetSha: sha, activeCount: 0 },
      );
      await expect(
        runStagingAcceptanceCli(sha, context.env, context),
      ).rejects.toThrow();
      expect(context.output).toEqual([]);
      expect(context.end).toHaveBeenCalledOnce();
    }
  });
});
