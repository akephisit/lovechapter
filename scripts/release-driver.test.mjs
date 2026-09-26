import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import { createReleaseDriver } from "./release-driver.mjs";
import { runCutover } from "./release-orchestrator.mjs";

const sha = "a".repeat(40);
const previousSha = "b".repeat(40);
const previous = {
  web: { versionId: "web-old", sourceSha: previousSha },
  api: { versionId: "api-old", sourceSha: previousSha },
};
const checks = [
  "verification_outbox",
  "reset_outbox",
  "verified_session",
  "tenant_isolation",
  "guest_rsvp",
  "csv_round_trip",
  "session_revoked",
  "scoped_cleanup",
  "scheduled_email_provider",
  "scheduled_cleanup",
  "query_plans",
  "postgres_retry",
];
const input = {
  environment: "staging",
  sha,
  impact: { web: true, backend: false, migrate: false },
  migration: { kind: "none", paths: [] },
};

function fixture({
  acceptedChecks = checks,
  driverOverrides = {},
  baselineOverrides = {},
} = {}) {
  const events = [];
  const versions = { web: "web-old", api: "api-old" };
  const workerRunner = {
    validateTarget: vi.fn(async () => ({
      web: "lovechapter-web-staging",
      api: "lovechapter-api-staging",
    })),
    readPreviewSettings: vi.fn(async () => ({ previewsEnabled: false })),
    readDeployment: vi.fn(async (component) => ({
      workerName: `lovechapter-${component}-staging`,
      versions: [{ version_id: versions[component], percentage: 100 }],
    })),
    buildWeb: vi.fn(async () => events.push("build_web")),
    dryRunWeb: vi.fn(async () => events.push("dry_run_web")),
    scanWebClientBundle: vi.fn(async () => events.push("scan_web")),
    promoteWeb: vi.fn(async () => {
      events.push("promote_web");
      versions.web = "web-new";
    }),
    buildApi: vi.fn(async () => {
      throw new Error("unexpected API build");
    }),
    dryRunApi: vi.fn(async () => {
      throw new Error("unexpected API dry-run");
    }),
    uploadApi: vi.fn(async () => {
      throw new Error("unexpected API upload");
    }),
    promoteApi: vi.fn(async () => {
      throw new Error("unexpected API promote");
    }),
  };
  const gateState = {
    mode: "open",
    targetSha: previousSha,
    changedAt: "2026-09-26T00:00:00.000Z",
    activeCount: 0,
    ...previous,
    ...baselineOverrides,
  };
  let evidence;
  const gate = {
    status: vi.fn(async () => ({ ...gateState })),
    close: vi.fn(async (candidate) => {
      events.push("close");
      gateState.mode = "maintenance";
      gateState.targetSha = candidate;
      return { ...gateState };
    }),
    drain: vi.fn(async () => {
      events.push("drain");
      return { ...gateState };
    }),
    open: vi.fn(async (candidate, submitted) => {
      events.push("open");
      evidence = submitted;
      gateState.mode = "open";
      gateState.targetSha = candidate;
      gateState.web = {
        versionId: submitted.web.versionId,
        sourceSha: submitted.web.sourceSha,
      };
      gateState.api = {
        versionId: submitted.api.versionId,
        sourceSha: submitted.api.sourceSha,
      };
      return { ...gateState };
    }),
    reclose: vi.fn(async (candidate) => {
      events.push("reclose");
      gateState.mode = "maintenance";
      gateState.targetSha = candidate;
      return { ...gateState };
    }),
  };
  const fetcher = vi.fn(async (url, options = {}) => {
    const parsed = new globalThis.URL(url);
    const headers = new globalThis.Headers(options.headers);
    const isWeb = parsed.hostname.includes("-web-");
    const path = parsed.pathname;
    if (!isWeb && path === "/health/release-state") {
      return globalThis.Response.json({ mode: gateState.mode });
    }
    if (!isWeb && ["/health/ready", "/health/live"].includes(path)) {
      return globalThis.Response.json({ status: "ok" });
    }
    if (!isWeb && !headers.has("x-lovechapter-proxy-secret")) {
      return globalThis.Response.json({}, { status: 403 });
    }
    if (isWeb && path === "/sign-in") {
      const allowed =
        gateState.mode === "open" || headers.has("x-lovechapter-release-probe");
      return new globalThis.Response("<html>LoveChapter</html>", {
        status: allowed ? 200 : 503,
        headers: { "content-type": "text/html" },
      });
    }
    if (gateState.mode === "maintenance") {
      return globalThis.Response.json({}, { status: 503 });
    }
    return globalThis.Response.json({}, { status: 401 });
  });
  const acceptStaging = vi.fn(async () => ({
    commitSha: sha,
    checks: acceptedChecks,
    inboxDelivery: "waived",
  }));
  const driver = createReleaseDriver({
    environment: "staging",
    sha,
    impact: input.impact,
    previous,
    hyperdriveId: "staging-hyperdrive",
    workerRunner,
    gate,
    githubRead: { readMainHead: vi.fn(async () => sha) },
    webOrigin: "https://lovechapter-web-staging.example.workers.dev",
    apiOrigin: "https://lovechapter-api-staging.example.workers.dev",
    proxySecret: Buffer.alloc(32, 1).toString("base64url"),
    probeSecret: Buffer.alloc(32, 2).toString("base64url"),
    verifyStaging: vi.fn(async () => ({ targetVerified: true })),
    applyMigration: vi.fn(async () => ({ status: "applied_and_validated" })),
    acceptStaging,
    fetcher,
    now: () => new Date("2026-09-26T00:01:00.000Z"),
    ...driverOverrides,
  });
  return {
    driver,
    gate,
    workerRunner,
    events,
    acceptStaging,
    getEvidence: () => evidence,
  };
}

describe("concrete release driver composition", () => {
  it("rejects unsafe smoke configuration before any release step", () => {
    for (const driverOverrides of [
      { probeSecret: "not-canonical" },
      { proxySecret: "not-canonical" },
      { webOrigin: "https://unowned.example.com" },
      { webOrigin: "https://lovechapter-web.example.workers.dev" },
      { apiOrigin: "https://lovechapter-web-staging.example.workers.dev" },
    ]) {
      expect(() => fixture({ driverOverrides })).toThrow(
        /driver is incomplete/iu,
      );
    }
  });

  it("rejects a closed or mismatched gate baseline before building or closing", async () => {
    for (const baselineOverrides of [
      { mode: "maintenance" },
      { api: { versionId: "unexpected", sourceSha: previousSha } },
    ]) {
      const { driver, gate, workerRunner } = fixture({ baselineOverrides });
      await expect(runCutover(input, driver)).rejects.toThrow(
        /gate baseline/iu,
      );
      expect(workerRunner.buildWeb).not.toHaveBeenCalled();
      expect(gate.close).not.toHaveBeenCalled();
    }
  });

  it("prepares only the changed Worker and passes exact selective evidence into gate reopen", async () => {
    const { driver, gate, workerRunner, events, getEvidence } = fixture();
    const result = await runCutover(input, driver);
    expect(result.status).toBe("released");
    expect(events).toEqual([
      "build_web",
      "dry_run_web",
      "scan_web",
      "close",
      "drain",
      "promote_web",
      "open",
    ]);
    expect(workerRunner.buildApi).not.toHaveBeenCalled();
    expect(gate.close).toHaveBeenCalledOnce();
    expect(getEvidence()).toMatchObject({
      environment: "staging",
      commitSha: sha,
      web: { versionId: "web-new", sourceSha: sha, changed: true },
      api: { versionId: "api-old", sourceSha: previousSha, changed: false },
      privateSmokePassed: true,
      inboxDelivery: "waived",
    });
    expect(result.recorded.stagingAcceptance.checks).toEqual(checks);
  });

  it("recloses after staging acceptance omits any required check", async () => {
    const { driver, gate, acceptStaging, events } = fixture({
      acceptedChecks: checks.slice(0, -1),
    });
    await expect(runCutover(input, driver)).rejects.toThrow(
      /staging acceptance/iu,
    );
    expect(acceptStaging).toHaveBeenCalledOnce();
    expect(gate.reclose).toHaveBeenCalledOnce();
    expect(events.at(-1)).toBe("reclose");
  });

  it("records production success only for the opened exact Worker pair", async () => {
    const deployed = {
      web: { versionId: "web-new", sourceSha: sha },
      api: { versionId: "api-new", sourceSha: sha },
    };
    const opened = { mode: "open", targetSha: sha, ...deployed };
    const githubDeployment = {
      createDeployment: vi.fn(async () => ({ id: 42 })),
      createDeploymentStatus: vi.fn(async () => ({ id: 43 })),
    };
    const driver = createReleaseDriver({
      environment: "production",
      sha,
      impact: { web: true, backend: true, migrate: false },
      previous,
      hyperdriveId: "production-hyperdrive",
      workerRunner: {},
      gate: {
        status: vi.fn(),
        close: vi.fn(),
        drain: vi.fn(),
        open: vi.fn(),
        reclose: vi.fn(),
      },
      githubRead: { readMainHead: vi.fn() },
      githubDeployment,
      webOrigin: "https://lovechapter-web.example.workers.dev",
      apiOrigin: "https://lovechapter-api.example.workers.dev",
      proxySecret: Buffer.alloc(32, 1).toString("base64url"),
      probeSecret: Buffer.alloc(32, 2).toString("base64url"),
      stagingSha: sha,
      verifyProduction: vi.fn(),
      applyMigration: vi.fn(),
    });
    await expect(
      driver.record(sha, { deployed, opened, publicResult: { passed: true } }),
    ).resolves.toBe(42);
    expect(githubDeployment.createDeployment).toHaveBeenCalledWith({
      ref: sha,
      environment: "production",
      task: "lovechapter-worker-release",
      payload: deployed,
      auto_merge: false,
      required_contexts: [],
    });
    expect(githubDeployment.createDeploymentStatus).toHaveBeenCalledWith(42, {
      state: "success",
      environment: "production",
    });
    await expect(
      driver.record(sha, { deployed, opened, publicResult: { passed: false } }),
    ).rejects.toThrow();
    expect(githubDeployment.createDeployment).toHaveBeenCalledOnce();
  });
});
