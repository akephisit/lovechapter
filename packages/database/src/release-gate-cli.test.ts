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
  } = {},
) {
  let mode = initial.mode ?? "open";
  let targetSha = initial.targetSha ?? null;
  let leases = initial.leases ?? 0;
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
      return { rows: [{ id: 1 }], rowCount: 1 };
    }
    if (statement.includes("count(*)")) {
      return { rows: [{ count: String(leases) }], rowCount: 1 };
    }
    if (statement.includes("select mode, target_sha")) {
      return {
        rows: [{ mode, target_sha: targetSha, changed_at: changedAt }],
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
  };
  return {
    createClient,
    connect,
    end,
    query,
    output,
    environment,
    write: (line: string) => output.push(line),
    state: () => ({ mode, targetSha, leases }),
    setLeases: (count: number) => {
      leases = count;
    },
  };
}

function evidence(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    commitSha: sha,
    apiWorkerVersion: "api-version-1",
    webWorkerVersion: "web-version-1",
    migrationChecked: true,
    privateSmokePassed: true,
    acceptedAt: "2026-09-26T07:00:00.000Z",
    ...overrides,
  });
}

describe("release gate CLI", () => {
  it("redacts status", async () => {
    const context = fixture({ mode: "maintenance", targetSha: sha, leases: 2 });
    await runReleaseGateCli(["status"], context.environment, {
      createClient: context.createClient,
      write: context.write,
    });
    expect(context.output).toEqual([
      JSON.stringify({ mode: "maintenance", targetSha: sha, activeCount: 2 }),
    ]);
    expect(context.output.join(" ")).not.toContain("private-credential");
    expect(context.end).toHaveBeenCalledOnce();
  });

  it("rejects unsafe reopen evidence", async () => {
    for (const invalid of [
      { commitSha: otherSha },
      { apiWorkerVersion: "" },
      { webWorkerVersion: "" },
      { migrationChecked: false },
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
      { ...context.environment, RELEASE_ENVIRONMENT: "production" },
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
          { createClient: context.createClient },
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
        }),
      ).rejects.toThrow();
    }
    expect(context.createClient).not.toHaveBeenCalled();
  });
});
