import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import { runLiveRelease } from "./live-release.mjs";
import { REQUIRED_STAGING_CHECKS } from "./release-orchestrator.mjs";

const sha = "a".repeat(40);
const secret = Buffer.alloc(32, 1).toString("base64url");
const otherSecret = Buffer.alloc(32, 2).toString("base64url");

function environment() {
  return {
    GITHUB_OUTPUT: "/tmp/github-release-output-test",
    GITHUB_TOKEN: "test-github-token",
    RELEASE_ENVIRONMENT: "staging",
    RELEASE_POSTGRES_JOB_RESULT: "success",
    RELEASE_NEON_PROJECT_ID: "icy-hat-79862899",
    RELEASE_NEON_BRANCH_ID: "br-staging-123",
    RELEASE_DATABASE_NAME: "lovechapter",
    RELEASE_DATABASE_ROLE: "release",
    RELEASE_APP_DATABASE_ROLE: "app",
    RELEASE_MIGRATION_DATABASE_ROLE: "migrator",
    RELEASE_CLOUDFLARE_ACCOUNT_ID: "cf-account-123",
    RELEASE_HYPERDRIVE_ID: "staging-hyperdrive-123",
    RELEASE_WEB_ORIGIN: "https://lovechapter-web-staging.example.workers.dev",
    RELEASE_API_ORIGIN: "https://lovechapter-api-staging.example.workers.dev",
    RELEASE_DATABASE_URL:
      "postgresql://release:private-password@ep-staging.neon.tech/lovechapter?sslmode=require",
    RELEASE_MIGRATION_DATABASE_URL:
      "postgresql://migrator:private-password@ep-staging.neon.tech/lovechapter?sslmode=require",
    RELEASE_NEON_API_KEY: "neon-test-secret",
    RELEASE_CLOUDFLARE_API_TOKEN: "cf-test-secret",
    WEB_PROXY_SHARED_SECRET: secret,
    RELEASE_PROBE_SECRET: otherSecret,
    RELEASE_TEST_EMAIL: "verified@example.test",
    RELEASE_TEST_PASSWORD: "private-test-password",
    RELEASE_VERIFICATION_EMAIL: "verify@example.test",
    RELEASE_FOREIGN_WEDDING_ID: "22222222-2222-4222-8222-222222222222",
    RELEASE_TEST_DATABASE_URL:
      "postgresql://tester:test-password@ep-test.neon.tech/lovechapter?sslmode=require",
    RELEASE_TEST_BRANCH_ID: "br-test-456",
    RELEASE_TEST_DATABASE_CONFIRM: "lovechapter_test",
  };
}

function services() {
  const gate = { status: vi.fn() };
  const workerRunner = { label: "worker-runner" };
  const githubRead = { readMainHead: vi.fn() };
  const migration = vi.fn();
  const preflight = vi.fn(async () => ({ targetVerified: true }));
  const acceptance = vi.fn();
  const makeGate = vi.fn(() => gate);
  const makeWorkerRunner = vi.fn(() => workerRunner);
  const makeGitHubRead = vi.fn(() => githubRead);
  const makeMigration = vi.fn(() => migration);
  const makePreflight = vi.fn(() => preflight);
  const makeAcceptance = vi.fn(() => acceptance);
  const makeReleaseDriver = vi.fn((config) => ({ config }));
  const accepted = {
    commitSha: sha,
    checks: [...REQUIRED_STAGING_CHECKS],
    inboxDelivery: "waived",
  };
  const execute = vi.fn(async (_input, adapters) => {
    adapters.createDriver({
      environment: "staging",
      sha,
      impact: { web: true, backend: false, migrate: false },
      previous: {
        web: { versionId: "web-old", sourceSha: "b".repeat(40) },
        api: { versionId: "api-old", sourceSha: "b".repeat(40) },
      },
    });
    return {
      status: "released",
      environment: "staging",
      sha,
      recorded: { stagingAcceptance: accepted },
    };
  });
  const writeOutput = vi.fn(async () => undefined);
  return {
    makeGate,
    makeWorkerRunner,
    makeGitHubRead,
    makeMigration,
    makePreflight,
    makeAcceptance,
    makeReleaseDriver,
    execute,
    writeOutput,
    gate,
    workerRunner,
    githubRead,
    migration,
    preflight,
    acceptance,
  };
}

describe("default live release composition", () => {
  it("connects staging preflight, migration, acceptance, and exact output", async () => {
    const env = environment();
    const adapters = services();
    const result = await runLiveRelease(
      { environment: "staging", sha },
      env,
      adapters,
    );
    expect(result.status).toBe("released");
    expect(adapters.execute).toHaveBeenCalledWith(
      { environment: "staging", sha },
      expect.objectContaining({ gate: adapters.gate }),
    );
    const config = adapters.makeReleaseDriver.mock.calls[0][0];
    expect(config.workerRunner).toBe(adapters.workerRunner);
    expect(config.githubRead).toBe(adapters.githubRead);
    expect(config.verifyStaging).toBe(adapters.preflight);
    expect(config.applyMigration).toBe(adapters.migration);
    expect(config.acceptStaging).toBe(adapters.acceptance);
    expect(config.proxySecret).toBe(secret);
    expect(config.probeSecret).toBe(otherSecret);
    expect(adapters.writeOutput).toHaveBeenCalledWith(
      result,
      env.GITHUB_OUTPUT,
    );
  });

  it("refuses incomplete staging setup before creating a gate or Worker runner", async () => {
    for (const edit of [
      { GITHUB_OUTPUT: "" },
      { RELEASE_POSTGRES_JOB_RESULT: "skipped" },
      { RELEASE_TEST_DATABASE_URL: "" },
      { RELEASE_APP_DATABASE_ROLE: "" },
      { RELEASE_PROBE_SECRET: "" },
    ]) {
      const adapters = services();
      await expect(
        runLiveRelease(
          { environment: "staging", sha },
          { ...environment(), ...edit },
          adapters,
        ),
      ).rejects.toThrow();
      expect(adapters.makeGate).not.toHaveBeenCalled();
      expect(adapters.execute).not.toHaveBeenCalled();
    }
  });

  it("leaves production unavailable until protected bootstrap exists", async () => {
    const adapters = services();
    await expect(
      runLiveRelease(
        { environment: "production", sha },
        environment(),
        adapters,
      ),
    ).rejects.toThrow();
    expect(adapters.makeGate).not.toHaveBeenCalled();
  });

  it("does not write a staging acceptance output for a docs-only skip", async () => {
    const adapters = services();
    adapters.execute.mockResolvedValueOnce({
      status: "skipped",
      reason: "docs_only",
      sha,
    });
    await runLiveRelease(
      { environment: "staging", sha },
      environment(),
      adapters,
    );
    expect(adapters.writeOutput).not.toHaveBeenCalled();
  });
});
