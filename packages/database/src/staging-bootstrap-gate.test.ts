import type { Client } from "pg";
import { describe, expect, it, vi } from "vitest";

const sha = "a".repeat(40);
const changedAt = "2026-09-27T06:00:00.000Z";

describe("pre-schema staging bootstrap gate", () => {
  it("reads gate and bounded lease details without 0011 version columns", async () => {
    const statements: string[] = [];
    const query = vi.fn(async (statement: string) => {
      statements.push(statement);
      if (statement.includes("from ops.release_control")) {
        return {
          rows: [
            {
              mode: "maintenance",
              target_sha: sha,
              changed_at: changedAt,
            },
          ],
          rowCount: 1,
        };
      }
      if (statement.includes("count(*)")) {
        return { rows: [{ count: "101" }], rowCount: 1 };
      }
      if (statement.includes("from ops.release_leases")) {
        return {
          rows: [
            {
              id: "00000000-0000-4000-8000-000000000001",
              kind: "http",
              started_at: new Date(changedAt),
            },
          ],
          rowCount: 1,
        };
      }
      throw new Error("Unexpected SQL");
    });
    const { PostgresStagingBootstrapGate } =
      await import("./staging-bootstrap-gate");
    const gate = new PostgresStagingBootstrapGate({
      query,
    } as unknown as Client);

    expect(await gate.status()).toEqual({
      mode: "maintenance",
      targetSha: sha,
      changedAt,
      activeCount: 101,
      oldestLeases: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          kind: "http",
          startedAt: changedAt,
        },
      ],
    });
    expect(statements.join("\n")).not.toMatch(
      /(?:web|api)_(?:version_id|source_sha)/u,
    );
    expect(
      statements.find((statement) => statement.includes("order by started_at")),
    ).toMatch(/order by started_at, id limit 100/u);
  });

  it("closes an open gate once and preserves the closure timestamp on retry", async () => {
    let mode: "open" | "maintenance" = "open";
    let targetSha: string | null = null;
    let currentChangedAt = "2026-09-27T05:00:00.000Z";
    const statements: string[] = [];
    const query = vi.fn(async (statement: string, params?: unknown[]) => {
      statements.push(statement);
      if (statement.includes("update ops.release_control")) {
        if (mode !== "open") return { rows: [], rowCount: 0 };
        mode = "maintenance";
        targetSha = String(params?.[0]);
        currentChangedAt = changedAt;
        return {
          rows: [{ changed_at: changedAt }],
          rowCount: 1,
        };
      }
      if (statement.includes("from ops.release_control")) {
        return {
          rows: [
            {
              mode,
              target_sha: targetSha,
              changed_at: currentChangedAt,
            },
          ],
          rowCount: 1,
        };
      }
      if (statement.includes("count(*)")) {
        return { rows: [{ count: "0" }], rowCount: 1 };
      }
      if (statement.includes("from ops.release_leases")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error("Unexpected SQL");
    });
    const { PostgresStagingBootstrapGate } =
      await import("./staging-bootstrap-gate");
    const gate = new PostgresStagingBootstrapGate({
      query,
    } as unknown as Client);

    await expect(gate.closeOnce("A".repeat(40))).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
    const closure = await gate.closeOnce(sha);
    expect(closure).toMatchObject({
      mode: "maintenance",
      targetSha: sha,
      changedAt,
    });
    expect(
      statements.find((statement) =>
        statement.includes("update ops.release_control"),
      ),
    ).toMatch(/where id = 1 and mode = 'open'/u);
    await expect(gate.closeOnce(sha)).rejects.toThrow();
    await expect(gate.closeOnce("b".repeat(40))).rejects.toThrow();
    expect((await gate.status()).changedAt).toBe(changedAt);
  });

  it("drains leases for the original SHA and closure without mutating them", async () => {
    const remaining = [1, 0];
    const statements: string[] = [];
    const query = vi.fn(async (statement: string) => {
      statements.push(statement);
      if (statement.includes("from ops.release_control")) {
        return {
          rows: [
            { mode: "maintenance", target_sha: sha, changed_at: changedAt },
          ],
          rowCount: 1,
        };
      }
      if (statement.includes("count(*)")) {
        return {
          rows: [{ count: String(remaining.shift() ?? 0) }],
          rowCount: 1,
        };
      }
      if (statement.includes("from ops.release_leases")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error("Unexpected SQL");
    });
    const { PostgresStagingBootstrapGate } =
      await import("./staging-bootstrap-gate");
    const gate = new PostgresStagingBootstrapGate({
      query,
    } as unknown as Client);

    const drained = await gate.drain(sha, changedAt, {
      deadlineMs: Date.now() + 3_000,
    });
    expect(drained).toMatchObject({
      mode: "maintenance",
      targetSha: sha,
      changedAt,
      activeCount: 0,
    });
    expect(
      statements.filter((statement) => statement.includes("count(*)")),
    ).toHaveLength(2);
    expect(statements.join("\n")).not.toMatch(/\b(?:delete|update)\b/iu);
  });

  it("rejects a changed closure on a later drain poll", async () => {
    const { PostgresStagingBootstrapGate } =
      await import("./staging-bootstrap-gate");
    const gate = new PostgresStagingBootstrapGate({} as Client);
    const status = vi.spyOn(gate, "status");
    status
      .mockResolvedValueOnce({
        mode: "maintenance",
        targetSha: sha,
        changedAt,
        activeCount: 1,
        oldestLeases: [],
      })
      .mockResolvedValueOnce({
        mode: "maintenance",
        targetSha: "b".repeat(40),
        changedAt,
        activeCount: 0,
        oldestLeases: [],
      });
    vi.useFakeTimers();
    try {
      const draining = gate.drain(sha, changedAt, {
        deadlineMs: Date.now() + 2_000,
      });
      const rejected = expect(draining).rejects.toThrow(/closure changed/u);
      await vi.advanceTimersByTimeAsync(1_000);
      await rejected;
      expect(status).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out or aborts without expiring active leases", async () => {
    const { PostgresStagingBootstrapGate } =
      await import("./staging-bootstrap-gate");
    const query = vi.fn(async (statement: string) => {
      if (statement.includes("from ops.release_control")) {
        return {
          rows: [
            { mode: "maintenance", target_sha: sha, changed_at: changedAt },
          ],
          rowCount: 1,
        };
      }
      if (statement.includes("count(*)")) {
        return { rows: [{ count: "1" }], rowCount: 1 };
      }
      if (statement.includes("from ops.release_leases")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error("Unexpected SQL");
    });
    const gate = new PostgresStagingBootstrapGate({
      query,
    } as unknown as Client);

    await expect(
      gate.drain(sha, changedAt, { deadlineMs: Date.now() - 1 }),
    ).rejects.toThrow(/timed out/u);
    const controller = new AbortController();
    controller.abort();
    await expect(
      gate.drain(sha, changedAt, {
        deadlineMs: Date.now() + 2_000,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/interrupted/u);
    expect(query.mock.calls.flat().join("\n")).not.toMatch(
      /\b(?:delete|update)\b/iu,
    );
  });
});
