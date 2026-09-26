import type { Client } from "pg";
import { describe, expect, it, vi } from "vitest";

import { runReleaseGateCli } from "./release-gate-cli";

const sha = "a".repeat(40);
const otherSha = "b".repeat(40);
const databaseUrl =
  "postgresql://release:private-credential@ep-example.ap-southeast-1.aws.neon.tech/lovechapter?sslmode=require";

function fixture(
  initial: {
    mode?: "open" | "maintenance";
    targetSha?: string | null;
    leases?: number;
    changedAt?: string;
    web?: { versionId: string; sourceSha: string } | null;
    api?: { versionId: string; sourceSha: string } | null;
  } = {},
) {
  let mode = initial.mode ?? "open";
  let targetSha = initial.targetSha ?? null;
  let leases = initial.leases ?? 0;
  let web = initial.web ?? null;
  let api = initial.api ?? null;
  const changedAt = initial.changedAt ?? "2026-09-26T06:00:00.000Z";
  const query = vi.fn(async (statement: string, params?: unknown[]) => {
    if (statement.includes("set mode = 'maintenance'")) {
      if (mode === "maintenance" && targetSha !== params?.[0]) {
        return { rows: [], rowCount: 0 };
      }
      mode = "maintenance";
      targetSha = String(params?.[0]);
      return { rows: [{ id: 1 }], rowCount: 1 };
    }
    if (statement.includes("set mode = 'open'")) {
      if (
        mode !== "maintenance" ||
        targetSha !== params?.[0] ||
        changedAt !== params?.[1] ||
        leases
      ) {
        return { rows: [], rowCount: 0 };
      }
      mode = "open";
      web = { versionId: String(params?.[2]), sourceSha: String(params?.[3]) };
      api = { versionId: String(params?.[4]), sourceSha: String(params?.[5]) };
      return { rows: [{ id: 1 }], rowCount: 1 };
    }
    if (statement.includes("count(*)")) {
      return { rows: [{ count: String(leases) }], rowCount: 1 };
    }
    if (statement.includes("select mode, target_sha")) {
      return {
        rows: [
          {
            mode,
            target_sha: targetSha,
            changed_at: changedAt,
            web_version_id: web?.versionId ?? null,
            web_source_sha: web?.sourceSha ?? null,
            api_version_id: api?.versionId ?? null,
            api_source_sha: api?.sourceSha ?? null,
          },
        ],
        rowCount: 1,
      };
    }
    if (statement.includes("from ops.release_leases")) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error("Unexpected SQL");
  });
  const connect = vi.fn(async () => undefined);
  const end = vi.fn(async () => undefined);
  const client = { connect, end, query } as unknown as Client;
  const createClient = vi.fn(() => client);
  const output: string[] = [];
  const environment = {
    RELEASE_ENVIRONMENT: "staging",
    RELEASE_DATABASE_URL: databaseUrl,
    RELEASE_NEON_PROJECT_ID: "icy-hat-79862899",
    RELEASE_NEON_BRANCH_ID: "br-staging-123",
    RELEASE_DATABASE_NAME: "lovechapter",
    RELEASE_DATABASE_ROLE: "release",
    RELEASE_CLOUDFLARE_ACCOUNT_ID: "cf-account-123",
    RELEASE_HYPERDRIVE_ID: "staging-hyperdrive-123",
    RELEASE_NEON_API_KEY: "neon-test-secret",
    RELEASE_CLOUDFLARE_API_TOKEN: "cf-test-secret",
  };
  const fetcher = vi.fn(async (input: string | URL | Request) => {
    if (String(input).startsWith("https://console.neon.tech/")) {
      return new Response(
        JSON.stringify({
          endpoints: [
            {
              branch_id: environment.RELEASE_NEON_BRANCH_ID,
              host: "ep-example.ap-southeast-1.aws.neon.tech",
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
          origin: {
            host: "ep-example.ap-southeast-1.aws.neon.tech",
            database: "lovechapter",
            user: "release",
          },
          caching: { disabled: true },
        },
      }),
      { status: 200 },
    );
  });
  return {
    createClient,
    connect,
    end,
    query,
    output,
    environment,
    fetcher,
    write: (line: string) => output.push(line),
    state: () => ({ mode, targetSha, leases }),
    versions: () => ({ web, api }),
    setLeases: (count: number) => {
      leases = count;
    },
  };
}

function evidence(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    environment: "staging",
    commitSha: sha,
    api: { versionId: "api-version-1", sourceSha: sha, changed: true },
    web: { versionId: "web-version-1", sourceSha: sha, changed: true },
    migration: "not_required",
    privateSmokePassed: true,
    inboxDelivery: "waived",
    acceptedAt: "2026-09-26T07:00:00.000Z",
    ...overrides,
  });
}

describe("release gate CLI", () => {
  it("rejects legacy reopen evidence that lacks exact Worker versions", async () => {
    const context = fixture({ mode: "maintenance", targetSha: sha });
    await expect(
      runReleaseGateCli(
        ["open", "--sha", sha, "--evidence", "acceptance.json"],
        context.environment,
        {
          createClient: context.createClient,
          fetcher: context.fetcher,
          readEvidence: async () =>
            JSON.stringify({
              commitSha: sha,
              apiWorkerVersion: "api-version-1",
              webWorkerVersion: "web-version-1",
              migrationChecked: true,
              privateSmokePassed: true,
              acceptedAt: "2026-09-26T07:00:00.000Z",
            }),
        },
      ),
    ).rejects.toThrow();
    expect(context.state().mode).toBe("maintenance");
  });

  it("verifies production inventory before opening a database connection", async () => {
    const context = fixture();
    const productionHost = "ep-production.ap-southeast-1.aws.neon.tech";
    const environment = {
      RELEASE_ENVIRONMENT: "production",
      RELEASE_DATABASE_URL: databaseUrl.replace("ep-example", "ep-production"),
      RELEASE_NEON_PROJECT_ID: "icy-hat-79862899",
      RELEASE_NEON_BRANCH_ID: "br-production-456",
      RELEASE_DATABASE_NAME: "lovechapter",
      RELEASE_DATABASE_ROLE: "release",
      RELEASE_CLOUDFLARE_ACCOUNT_ID: "cf-account-123",
      RELEASE_HYPERDRIVE_ID: "production-hyperdrive-456",
      RELEASE_NEON_API_KEY: "neon-test-secret",
      RELEASE_CLOUDFLARE_API_TOKEN: "cf-test-secret",
    };
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).startsWith("https://console.neon.tech/")) {
        return new Response(
          JSON.stringify({
            endpoints: [
              {
                branch_id: environment.RELEASE_NEON_BRANCH_ID,
                host: productionHost,
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
            origin: {
              host: productionHost,
              database: "lovechapter",
              user: "release",
            },
            caching: { disabled: true },
          },
        }),
        { status: 200 },
      );
    });

    await runReleaseGateCli(["status"], environment, {
      createClient: context.createClient,
      write: context.write,
      fetcher,
    });
    expect(context.createClient).toHaveBeenCalledWith(
      environment.RELEASE_DATABASE_URL,
    );
    expect(fetcher).toHaveBeenCalledTimes(2);

    const wrongUrl = {
      ...environment,
      RELEASE_DATABASE_URL: databaseUrl,
    };
    context.createClient.mockClear();
    await expect(
      runReleaseGateCli(["status"], wrongUrl, {
        createClient: context.createClient,
        fetcher,
      }),
    ).rejects.toThrow();
    expect(context.createClient).not.toHaveBeenCalled();
  });

  it("blocks swapped Hyperdrive, enabled cache, and provider errors before connecting", async () => {
    const context = fixture();
    const good = await context.fetcher(
      "https://api.cloudflare.com/client/v4/accounts/cf-account-123/hyperdrive/configs/staging-hyperdrive-123",
    );
    const envelope = (await good.json()) as {
      success: boolean;
      result: {
        id: string;
        caching: { disabled: boolean };
      };
    };
    for (const replacement of [
      { ...envelope, result: { ...envelope.result, id: "other-hyperdrive" } },
      {
        ...envelope,
        result: { ...envelope.result, caching: { disabled: false } },
      },
    ]) {
      const fetcher = vi.fn(async (input: string | URL | Request) =>
        String(input).startsWith("https://console.neon.tech/")
          ? context.fetcher(input)
          : new Response(JSON.stringify(replacement), { status: 200 }),
      );
      await expect(
        runReleaseGateCli(["status"], context.environment, {
          createClient: context.createClient,
          fetcher,
        }),
      ).rejects.toThrow();
      expect(context.createClient).not.toHaveBeenCalled();
    }
    const providerFailure = vi.fn(
      async () =>
        new Response("cf-test-secret private-credential", { status: 503 }),
    );
    await expect(
      runReleaseGateCli(["status"], context.environment, {
        createClient: context.createClient,
        fetcher: providerFailure,
      }),
    ).rejects.toThrow("Neon inventory unavailable");
    expect(context.createClient).not.toHaveBeenCalled();
  });

  it("redacts status", async () => {
    const context = fixture({ mode: "maintenance", targetSha: sha, leases: 2 });
    await runReleaseGateCli(["status"], context.environment, {
      createClient: context.createClient,
      write: context.write,
      fetcher: context.fetcher,
    });
    expect(context.output).toEqual([
      JSON.stringify({
        mode: "maintenance",
        targetSha: sha,
        activeCount: 2,
        web: null,
        api: null,
      }),
    ]);
    expect(context.output.join(" ")).not.toContain("private-credential");
    expect(context.end).toHaveBeenCalledOnce();
  });

  it("rejects unsafe reopen evidence", async () => {
    for (const invalid of [
      { commitSha: otherSha },
      { api: { versionId: "", sourceSha: sha, changed: true } },
      { web: { versionId: "", sourceSha: sha, changed: true } },
      { migration: "unknown" },
      { privateSmokePassed: false },
      { acceptedAt: "not-a-date" },
      { acceptedAt: "2026" },
    ]) {
      const context = fixture({ mode: "maintenance", targetSha: sha });
      await expect(
        runReleaseGateCli(
          ["open", "--sha", sha, "--evidence", "acceptance.json"],
          context.environment,
          {
            createClient: context.createClient,
            write: context.write,
            fetcher: context.fetcher,
            readEvidence: async () => evidence(invalid),
          },
        ),
      ).rejects.toThrow();
      expect(context.state().mode).toBe("maintenance");
      expect(context.end).toHaveBeenCalledOnce();
    }
  });

  it("rejects missing, pooled, or wrong-environment credentials before connecting", async () => {
    const context = fixture();
    for (const environment of [
      { ...context.environment, RELEASE_DATABASE_URL: "" },
      {
        ...context.environment,
        RELEASE_ENVIRONMENT: "production",
        RELEASE_NEON_BRANCH_ID: "br-production-456",
      },
      {
        ...context.environment,
        RELEASE_DATABASE_URL: databaseUrl.replace(
          "ep-example",
          "ep-example-pooler",
        ),
      },
      {
        ...context.environment,
        RELEASE_DATABASE_URL: `${databaseUrl}&sslmode=disable`,
      },
    ]) {
      await expect(
        runReleaseGateCli(["close", "--sha", sha], environment, {
          createClient: context.createClient,
          write: context.write,
          fetcher: context.fetcher,
        }),
      ).rejects.toThrow();
    }
    expect(context.createClient).not.toHaveBeenCalled();
  });

  it("rejects PostgreSQL URL options that override the direct TLS connection", async () => {
    const context = fixture();
    for (const option of [
      "host=ep-example-pooler.ap-southeast-1.aws.neon.tech",
      "port=6432",
      "user=other_role",
      "database=other_database",
      "ssl=false",
      "channel_binding=disable",
      "channel_binding=require&channel_binding=disable",
    ]) {
      await expect(
        runReleaseGateCli(
          ["close", "--sha", sha],
          {
            ...context.environment,
            RELEASE_DATABASE_URL: `${databaseUrl}&${option}`,
          },
          { createClient: context.createClient, fetcher: context.fetcher },
        ),
      ).rejects.toThrow();
    }
    expect(context.createClient).not.toHaveBeenCalled();
  });

  it("leaves maintenance on interrupted drain", async () => {
    const context = fixture({ mode: "maintenance", targetSha: sha, leases: 1 });
    const controller = new AbortController();
    await expect(
      runReleaseGateCli(["drain", "--sha", sha], context.environment, {
        createClient: context.createClient,
        write: context.write,
        fetcher: context.fetcher,
        signal: controller.signal,
        sleep: async () => controller.abort(),
      }),
    ).rejects.toThrow();
    expect(context.state()).toEqual({
      mode: "maintenance",
      targetSha: sha,
      leases: 1,
    });
    expect(context.end).toHaveBeenCalledOnce();
  });

  it("leaves maintenance on drain timeout", async () => {
    const context = fixture({ mode: "maintenance", targetSha: sha, leases: 1 });
    let clock = 0;
    await expect(
      runReleaseGateCli(["drain", "--sha", sha], context.environment, {
        createClient: context.createClient,
        write: context.write,
        fetcher: context.fetcher,
        now: () => clock,
        drainTimeoutMs: 1_000,
        sleep: async () => {
          clock += 1_000;
        },
      }),
    ).rejects.toThrow("Drain timed out");
    expect(context.state().mode).toBe("maintenance");
    expect(context.end).toHaveBeenCalledOnce();
  });

  it("requires matching SHA and zero leases before reopening", async () => {
    const context = fixture({ mode: "maintenance", targetSha: sha, leases: 1 });
    const options = {
      createClient: context.createClient,
      write: context.write,
      fetcher: context.fetcher,
      readEvidence: async () => evidence(),
    };
    await expect(
      runReleaseGateCli(
        ["open", "--sha", otherSha, "--evidence", "acceptance.json"],
        context.environment,
        options,
      ),
    ).rejects.toThrow();
    await expect(
      runReleaseGateCli(
        ["open", "--sha", sha, "--evidence", "acceptance.json"],
        context.environment,
        options,
      ),
    ).rejects.toThrow();
    expect(context.state().mode).toBe("maintenance");
    context.setLeases(0);
    await runReleaseGateCli(
      ["open", "--sha", sha, "--evidence", "acceptance.json"],
      context.environment,
      options,
    );
    expect(context.state().mode).toBe("open");
    expect(context.versions()).toEqual({
      web: { versionId: "web-version-1", sourceSha: sha },
      api: { versionId: "api-version-1", sourceSha: sha },
    });
  });

  it("atomically retains an unchanged API version on web-only reopen", async () => {
    const context = fixture({
      mode: "maintenance",
      targetSha: sha,
      api: { versionId: "api-previous", sourceSha: otherSha },
      web: { versionId: "web-previous", sourceSha: otherSha },
    });
    await runReleaseGateCli(
      ["open", "--sha", sha, "--evidence", "acceptance.json"],
      context.environment,
      {
        createClient: context.createClient,
        fetcher: context.fetcher,
        readEvidence: async () =>
          evidence({
            api: {
              versionId: "api-previous",
              sourceSha: otherSha,
              changed: false,
            },
          }),
      },
    );
    expect(context.versions()).toEqual({
      web: { versionId: "web-version-1", sourceSha: sha },
      api: { versionId: "api-previous", sourceSha: otherSha },
    });
    expect(context.query).toHaveBeenCalledWith(
      expect.stringContaining("web_version_id = $3"),
      [
        sha,
        "2026-09-26T06:00:00.000Z",
        "web-version-1",
        sha,
        "api-previous",
        otherSha,
      ],
    );
  });

  it("rejects evidence accepted before the current closure", async () => {
    const context = fixture({
      mode: "maintenance",
      targetSha: sha,
      changedAt: "2026-09-26T07:01:00.000Z",
    });
    await expect(
      runReleaseGateCli(
        ["open", "--sha", sha, "--evidence", "acceptance.json"],
        context.environment,
        {
          createClient: context.createClient,
          fetcher: context.fetcher,
          readEvidence: async () => evidence(),
        },
      ),
    ).rejects.toThrow();
    expect(context.state().mode).toBe("maintenance");
    expect(context.end).toHaveBeenCalledOnce();
  });

  it("rejects malformed command arguments without querying the database", async () => {
    const context = fixture();
    for (const args of [
      ["close", "--sha", "short"],
      ["close", "--sha", sha, "--unknown", "x"],
      ["drain"],
      ["open", "--sha", sha],
      ["clear-leases", "--sha", sha],
    ]) {
      await expect(
        runReleaseGateCli(args, context.environment, {
          createClient: context.createClient,
          write: context.write,
          fetcher: context.fetcher,
        }),
      ).rejects.toThrow();
    }
    expect(context.createClient).not.toHaveBeenCalled();
  });
});
