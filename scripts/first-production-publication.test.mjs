import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";

import {
  assertBootstrapLedgerCurrent,
  instrumentWorkerRunner,
  retargetClosedBootstrap,
  runFirstProductionPublication,
} from "./first-production-publication.mjs";

const oldSha = "a".repeat(40);
const sha = "b".repeat(40);
const secret = Buffer.alloc(32, 1).toString("base64url");
const probe = Buffer.alloc(32, 2).toString("base64url");
const oldWebVersionId = "9cda028a-48d0-4a6b-9659-f890bd2b286b";
const oldApiVersionId = "5a891058-2e6a-47e4-ab0d-6f0ff8cd128b";
const web = { versionId: "web-new", sourceSha: sha };
const api = { versionId: "api-new", sourceSha: sha };
const closure = {
  mode: "maintenance",
  targetSha: sha,
  changedAt: "2026-09-27T09:00:00.000Z",
  activeCount: 0,
  web: null,
  api: null,
};
const opened = { ...closure, mode: "open", web, api };

function fixture(overrides = {}) {
  const events = [];
  const env = {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REF_PROTECTED: "true",
    GITHUB_REPOSITORY: "akephisit/lovechapter",
    GITHUB_SHA: sha,
    PRODUCTION_RELEASE_ENABLED: "false",
    RELEASE_ENVIRONMENT: "production",
    RELEASE_DATABASE_URL:
      "postgresql://release:secret@test.invalid/db?sslmode=require",
    RELEASE_MIGRATION_DATABASE_URL:
      "postgresql://owner:secret@test.invalid/db?sslmode=require",
    RELEASE_MIGRATION_DATABASE_ROLE: "owner",
    RELEASE_NEON_PROJECT_ID: "project",
    RELEASE_NEON_BRANCH_ID: "branch",
    RELEASE_DATABASE_NAME: "db",
    RELEASE_DATABASE_ROLE: "release",
    RELEASE_APP_DATABASE_ROLE: "app",
    RELEASE_CLOUDFLARE_ACCOUNT_ID: "account",
    RELEASE_HYPERDRIVE_ID: "hyperdrive",
    RELEASE_NEON_API_KEY: "neon-key",
    RELEASE_CLOUDFLARE_API_TOKEN: "cf-key",
    RELEASE_WEB_ORIGIN: "https://lovechapter-web.example.workers.dev",
    RELEASE_API_ORIGIN: "https://lovechapter-api.example.workers.dev",
    WEB_PROXY_SHARED_SECRET: secret,
    RELEASE_PROBE_SECRET: probe,
    GITHUB_TOKEN: "github-key",
    BOOTSTRAP_PREVIOUS_SHA: oldSha,
    BOOTSTRAP_PREVIOUS_WEB_VERSION_ID: oldWebVersionId,
    BOOTSTRAP_PREVIOUS_API_VERSION_ID: oldApiVersionId,
    ...overrides.env,
  };
  const gate = {
    status: vi.fn(async () => {
      events.push("status");
      return gate.status.mock.calls.length === 1
        ? { ...closure, targetSha: oldSha }
        : opened;
    }),
    drain: vi.fn(async () => {
      events.push("drain");
      return closure;
    }),
    open: vi.fn(async () => {
      events.push("open");
      return opened;
    }),
    reclose: vi.fn(async () => {
      events.push("reclose");
      return { mode: "maintenance", targetSha: sha };
    }),
  };
  const adapters = {
    githubRead: {
      readMainHead: vi.fn(async () => {
        events.push("main");
        return sha;
      }),
    },
    gate,
    workerRunner: {},
    githubDeployment: {
      createDeployment: vi.fn(async () => ({ id: 1 })),
      createDeploymentStatus: vi.fn(async () => ({ id: 1 })),
      readProductionBaseline: vi.fn(async () => ({ sha, web, api })),
    },
    assertLedgerCurrent: vi.fn(async () => {
      events.push("ledger");
    }),
    prepare: vi.fn(async (input) => {
      events.push("prepare");
      return { ...input, webBuilt: true, apiUploadedVersionId: "api-new" };
    }),
    retarget: vi.fn(async () => {
      events.push("retarget");
    }),
    deploy: vi.fn(async () => {
      events.push("deploy");
      return { web, api };
    }),
    privateSmoke: vi.fn(async () => {
      events.push("private");
      return { passed: true, acceptedAt: "2026-09-27T09:01:00.000Z" };
    }),
    publicCheck: vi.fn(async () => {
      events.push("public");
      return { passed: true };
    }),
    record: vi.fn(async () => {
      events.push("record");
      return 1;
    }),
    ...overrides.adapters,
  };
  return { env, adapters, events };
}

describe("one-time production publication", () => {
  it("reports only fixed Worker preparation phase names", async () => {
    const phases = [];
    const runner = instrumentWorkerRunner(
      {
        readPreviewSettings: vi.fn(async () => ({ previewsEnabled: false })),
        buildWeb: vi.fn(async () => undefined),
      },
      (phase) => phases.push(phase),
    );
    await runner.readPreviewSettings("api", "production");
    await runner.buildWeb("production", sha);
    expect(phases).toEqual([
      "worker_readPreviewSettings_api",
      "worker_buildWeb",
    ]);
  });

  it("builds both Workers before retargeting the closed gate, then smokes and records", async () => {
    const { env, adapters, events } = fixture();
    await expect(runFirstProductionPublication(env, adapters)).resolves.toBe(1);
    expect(events).toEqual([
      "main",
      "status",
      "ledger",
      "prepare",
      "main",
      "retarget",
      "drain",
      "deploy",
      "private",
      "main",
      "open",
      "public",
      "record",
      "status",
    ]);
    expect(adapters.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: "production",
        sha,
        impact: { web: true, backend: true, migrate: false },
        previous: {
          web: { versionId: oldWebVersionId, sourceSha: oldSha },
          api: { versionId: oldApiVersionId, sourceSha: oldSha },
        },
      }),
      adapters.workerRunner,
    );
    expect(adapters.retarget).toHaveBeenCalledWith(
      expect.objectContaining({ targetSha: oldSha, web: null, api: null }),
      sha,
      env,
    );
    expect(adapters.gate.reclose).not.toHaveBeenCalled();
  });

  it("rejects an unsafe source before creating any adapter", async () => {
    const { env, adapters } = fixture({
      env: { GITHUB_REF_PROTECTED: "false" },
    });
    await expect(
      runFirstProductionPublication(env, adapters),
    ).rejects.toThrow();
    expect(adapters.githubRead.readMainHead).not.toHaveBeenCalled();
  });

  it("stops before gate retarget if the migration ledger is not current", async () => {
    const { env, adapters } = fixture({
      adapters: {
        reportPhase: vi.fn(),
        assertLedgerCurrent: vi.fn(async () => {
          throw new Error("drift");
        }),
      },
    });
    await expect(
      runFirstProductionPublication(env, adapters),
    ).rejects.toThrow();
    expect(adapters.retarget).not.toHaveBeenCalled();
    expect(adapters.reportPhase.mock.calls.at(-1)).toEqual([
      "migration_ledger",
    ]);
  });

  it("leaves maintenance closed if private smoke fails", async () => {
    const { env, adapters } = fixture({
      adapters: {
        privateSmoke: vi.fn(async () => {
          throw new Error("private failed");
        }),
      },
    });
    await expect(
      runFirstProductionPublication(env, adapters),
    ).rejects.toThrow();
    expect(adapters.gate.open).not.toHaveBeenCalled();
  });

  it("recloses after a post-open failure", async () => {
    const { env, adapters } = fixture({
      adapters: {
        publicCheck: vi.fn(async () => {
          throw new Error("public failed");
        }),
      },
    });
    await expect(
      runFirstProductionPublication(env, adapters),
    ).rejects.toThrow();
    expect(adapters.gate.reclose).toHaveBeenCalledWith(sha);
  });

  it("recloses when open may have committed but its status response failed", async () => {
    const { env, adapters } = fixture();
    adapters.gate.open = vi.fn(async () => {
      throw new Error("status unavailable after open");
    });
    await expect(
      runFirstProductionPublication(env, adapters),
    ).rejects.toThrow();
    expect(adapters.gate.reclose).toHaveBeenCalledWith(sha);
  });

  it("reports an incident when maintenance cannot be confirmed after opening", async () => {
    const { env, adapters } = fixture();
    adapters.publicCheck = vi.fn(async () => {
      throw new Error("public failed");
    });
    adapters.gate.reclose = vi.fn(async () => {
      throw new Error("database unavailable");
    });
    await expect(runFirstProductionPublication(env, adapters)).rejects.toThrow(
      "First publication incident: maintenance reclose failed",
    );
  });

  it("retargets only the unchanged, unpublished, lease-free closure", async () => {
    const query = vi.fn(async () => ({ rowCount: 1 }));
    const connect = vi.fn(async (_env, action) => action({ query }));
    const { env } = fixture();
    const old = { ...closure, targetSha: oldSha };
    await retargetClosedBootstrap(old, sha, env, connect);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("not exists (select 1 from ops.release_leases)"),
      [oldSha, sha, closure.changedAt],
    );
    expect(query.mock.calls[0][0]).toContain("web_version_id is null");
    expect(query.mock.calls[0][0]).toContain("changed_at = $3::timestamptz");
    await expect(
      retargetClosedBootstrap({ ...old, activeCount: 1 }, sha, env, connect),
    ).rejects.toThrow();
    await expect(
      retargetClosedBootstrap({ ...old, web }, sha, env, connect),
    ).rejects.toThrow();
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("rejects a compare-and-swap miss without opening", async () => {
    const connect = vi.fn(async (_env, action) =>
      action({ query: vi.fn(async () => ({ rowCount: 0 })) }),
    );
    const { env } = fixture();
    await expect(
      retargetClosedBootstrap(
        { ...closure, targetSha: oldSha },
        sha,
        env,
        connect,
      ),
    ).rejects.toThrow("changed during retarget");
  });

  it("uses the same-target migration credential for the exact ledger check", async () => {
    const { env } = fixture();
    const connect = vi.fn(async (connectionEnv, action) =>
      action({ query: vi.fn(async () => ({ rows: [] })) }),
    );
    await expect(assertBootstrapLedgerCurrent(env, connect)).rejects.toThrow(
      "ledger is not current",
    );
    expect(connect.mock.calls[0][0].RELEASE_DATABASE_URL).toBe(
      env.RELEASE_MIGRATION_DATABASE_URL,
    );
    const wrongBranch = {
      ...env,
      RELEASE_MIGRATION_DATABASE_URL:
        "postgresql://owner:secret@other.invalid/db?sslmode=require",
    };
    await expect(
      assertBootstrapLedgerCurrent(wrongBranch, connect),
    ).rejects.toThrow("migration target is invalid");
    const overriddenHost = {
      ...env,
      RELEASE_MIGRATION_DATABASE_URL:
        "postgresql://owner:secret@test.invalid/db?sslmode=require&host=other.invalid",
    };
    await expect(
      assertBootstrapLedgerCurrent(overriddenHost, connect),
    ).rejects.toThrow("migration target is invalid");
    expect(connect).toHaveBeenCalledTimes(1);
  });
});
