import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import { runLiveRelease } from "./live-release.mjs";

const sha = "a".repeat(40);
const prior = "b".repeat(40);
const secret = Buffer.alloc(32, 1).toString("base64url");
const otherSecret = Buffer.alloc(32, 2).toString("base64url");

function environment(overrides = {}) {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REF_PROTECTED: "true",
    GITHUB_REPOSITORY: "akephisit/lovechapter",
    GITHUB_SHA: sha,
    GITHUB_TOKEN: "test-github-token",
    PRODUCTION_RELEASE_ENABLED: "true",
    RELEASE_ENVIRONMENT: "production",
    RELEASE_POSTGRES_JOB_RESULT: "success",
    RELEASE_NEON_PROJECT_ID: "icy-hat-79862899",
    RELEASE_NEON_BRANCH_ID: "br-production-456",
    RELEASE_DATABASE_NAME: "lovechapter",
    RELEASE_DATABASE_ROLE: "release",
    RELEASE_APP_DATABASE_ROLE: "app",
    RELEASE_MIGRATION_DATABASE_ROLE: "migrator",
    RELEASE_CLOUDFLARE_ACCOUNT_ID: "cf-account-123",
    RELEASE_HYPERDRIVE_ID: "production-hyperdrive-456",
    RELEASE_WEB_ORIGIN: "https://lovechapter-web.example.workers.dev",
    RELEASE_API_ORIGIN: "https://lovechapter-api.example.workers.dev",
    RELEASE_DATABASE_URL:
      "postgresql://release:private-password@ep-production.neon.tech/lovechapter?sslmode=require",
    RELEASE_MIGRATION_DATABASE_URL:
      "postgresql://migrator:private-password@ep-production.neon.tech/lovechapter?sslmode=require",
    RELEASE_NEON_API_KEY: "neon-test-secret",
    RELEASE_CLOUDFLARE_API_TOKEN: "cf-test-secret",
    WEB_PROXY_SHARED_SECRET: secret,
    RELEASE_PROBE_SECRET: otherSecret,
    ...overrides,
  };
}

function services({ head = sha, result = { status: "released", sha } } = {}) {
  const gate = { status: vi.fn(async () => ({ targetSha: prior })) };
  const workerRunner = { label: "worker-runner" };
  const githubRead = { readMainHead: vi.fn(async () => head) };
  const githubDeployment = { readProductionBaseline: vi.fn() };
  const migration = vi.fn();
  const makeReleaseDriver = vi.fn((config) => ({ config }));
  const makeRecoveryPoint = vi.fn(async () => ({
    snapshotId: "snap-one",
    sourceBranchId: "br-production-456",
  }));
  const execute = vi.fn(async (_input, adapters) => {
    adapters.createDriver({
      environment: "production",
      sha,
      baselineSha: prior,
      impact: { web: true, backend: false, migrate: false },
      previous: {
        web: { versionId: "web-old", sourceSha: prior },
        api: { versionId: "api-old", sourceSha: prior },
      },
    });
    return result;
  });
  return {
    makeGate: vi.fn(() => gate),
    makeWorkerRunner: vi.fn(() => workerRunner),
    makeGitHubRead: vi.fn(() => githubRead),
    makeGitHubDeployment: vi.fn(() => githubDeployment),
    makeMigration: vi.fn(() => migration),
    makeRecoveryPoint,
    makeReleaseDriver,
    execute,
    gate,
    workerRunner,
    githubRead,
    githubDeployment,
    migration,
  };
}

describe("direct production live release composition", () => {
  it("wires the production gate, GitHub ledger, migration and recovery without staging inputs", async () => {
    const env = environment();
    const adapters = services();
    await expect(
      runLiveRelease({ environment: "production", sha }, env, adapters),
    ).resolves.toMatchObject({ status: "released" });
    expect(adapters.execute).toHaveBeenCalledWith(
      { environment: "production", sha },
      expect.objectContaining({
        gate: adapters.gate,
        ledger: adapters.githubDeployment,
      }),
    );
    const config = adapters.makeReleaseDriver.mock.calls[0][0];
    expect(config).toMatchObject({
      environment: "production",
      sha,
      githubRead: adapters.githubRead,
      githubDeployment: adapters.githubDeployment,
      workerRunner: adapters.workerRunner,
      applyMigration: adapters.migration,
    });
    expect(config).not.toHaveProperty("stagingSha");
    expect(config).not.toHaveProperty("acceptStaging");
    await expect(config.verifyProduction()).resolves.toEqual({
      releaseEnabled: true,
      protectedMain: true,
      targetVerified: true,
      baseline: { expectedSha: prior, currentSha: prior },
    });
    await expect(
      config.createRecoveryPoint(sha, {
        closure: { changedAt: "2026-09-27T00:00:00.000Z" },
      }),
    ).resolves.toMatchObject({ snapshotId: "snap-one" });
    expect(adapters.makeRecoveryPoint).toHaveBeenCalledWith({
      projectId: env.RELEASE_NEON_PROJECT_ID,
      branchId: env.RELEASE_NEON_BRANCH_ID,
      sha,
      closedAt: "2026-09-27T00:00:00.000Z",
      apiKey: env.RELEASE_NEON_API_KEY,
    });
  });

  it("rejects stale main before loading the gate or Worker runner", async () => {
    const adapters = services({ head: prior });
    await expect(
      runLiveRelease(
        { environment: "production", sha },
        environment(),
        adapters,
      ),
    ).rejects.toThrow(/superseded/u);
    expect(adapters.makeGate).not.toHaveBeenCalled();
    expect(adapters.makeWorkerRunner).not.toHaveBeenCalled();
  });

  it("rejects staging, unprotected context, missing credentials, and skipped PostgreSQL CI", async () => {
    for (const [selected, edit] of [
      ["staging", {}],
      ["production", { GITHUB_REF_PROTECTED: "false" }],
      ["production", { RELEASE_POSTGRES_JOB_RESULT: "skipped" }],
      ["production", { RELEASE_NEON_API_KEY: "" }],
      ["production", { RELEASE_HYPERDRIVE_ID: "REPLACE_WITH_HYPERDRIVE_ID" }],
      ["production", { WEB_PROXY_SHARED_SECRET: "" }],
    ]) {
      const adapters = services();
      await expect(
        runLiveRelease(
          { environment: selected, sha },
          environment(edit),
          adapters,
        ),
      ).rejects.toThrow();
      expect(adapters.makeGitHubRead).not.toHaveBeenCalled();
      expect(adapters.makeGate).not.toHaveBeenCalled();
    }
  });

  it("returns a docs-only skip without creating a deployment record", async () => {
    const adapters = services({
      result: { status: "skipped", reason: "docs_only", sha },
    });
    await expect(
      runLiveRelease(
        { environment: "production", sha },
        environment(),
        adapters,
      ),
    ).resolves.toEqual({ status: "skipped", reason: "docs_only", sha });
    expect(
      adapters.githubDeployment.readProductionBaseline,
    ).not.toHaveBeenCalled();
  });
});
