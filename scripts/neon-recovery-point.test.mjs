import { describe, expect, it, vi } from "vitest";

import { createNeonRecoveryPoint } from "./neon-recovery-point.mjs";

const sha = "a".repeat(40);
const input = {
  projectId: "icy-hat-79862899",
  branchId: "br-production",
  sha,
  closedAt: "2026-09-27T00:00:00.000Z",
  apiKey: "test-only-secret",
};
const snapshot = {
  id: "snap-one",
  name: `lovechapter-pre-migration-${sha}`,
  source_branch_id: input.branchId,
};
const operation = {
  id: "a07f8772-1877-4da9-a939-3a3ae62d1d8d",
  project_id: input.projectId,
  branch_id: input.branchId,
  status: "running",
};

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fetchSequence(...items) {
  return vi.fn(async () => {
    const item = items.shift();
    if (item instanceof Error) throw item;
    if (!item) throw new Error("Unexpected request");
    return item;
  });
}

describe("Neon pre-migration recovery point", () => {
  it("creates once, awaits the operation, and reads back the exact source snapshot", async () => {
    const fetcher = fetchSequence(
      response({ snapshot, operations: [operation] }),
      response({ operation: { ...operation, status: "finished" } }),
      response({ snapshots: [snapshot] }),
    );
    await expect(
      createNeonRecoveryPoint(input, { fetcher, wait: vi.fn() }),
    ).resolves.toEqual({
      snapshotId: snapshot.id,
      sourceBranchId: input.branchId,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(
      fetcher.mock.calls.map(([, options]) => options?.method ?? "GET"),
    ).toEqual(["POST", "GET", "GET"]);
    expect(fetcher.mock.calls[0][0]).toContain(
      `/projects/${input.projectId}/branches/${input.branchId}/snapshot?`,
    );
    expect(fetcher.mock.calls[0][0]).toContain(sha);
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(
      `Bearer ${input.apiKey}`,
    );
  });

  it.each([
    [
      "wrong source branch",
      response({
        snapshot: { ...snapshot, source_branch_id: "br-other" },
        operations: [],
      }),
    ],
    [
      "missing snapshot id",
      response({
        snapshot: { source_branch_id: input.branchId },
        operations: [],
      }),
    ],
    ["failed create", response({ error: "private" }, 403)],
    ["ambiguous create", new Error("network timeout")],
  ])("rejects %s without retrying POST", async (_name, first) => {
    const fetcher = fetchSequence(first);
    await expect(
      createNeonRecoveryPoint(input, { fetcher, wait: vi.fn() }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("rejects a failed asynchronous operation before readback", async () => {
    const fetcher = fetchSequence(
      response({ snapshot, operations: [operation] }),
      response({ operation: { ...operation, status: "failed" } }),
    );
    await expect(
      createNeonRecoveryPoint(input, { fetcher, wait: vi.fn() }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails closed when bounded readback never confirms the snapshot", async () => {
    const fetcher = fetchSequence(
      response({ snapshot, operations: [] }),
      response({ snapshots: [] }),
      response({ snapshots: [] }),
    );
    await expect(
      createNeonRecoveryPoint(input, {
        fetcher,
        wait: vi.fn(),
        maxAttempts: 2,
      }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("rejects a readback with the same ID on another branch", async () => {
    const fetcher = fetchSequence(
      response({ snapshot, operations: [] }),
      response({
        snapshots: [{ ...snapshot, source_branch_id: "br-other" }],
      }),
    );
    await expect(
      createNeonRecoveryPoint(input, { fetcher, wait: vi.fn() }),
    ).rejects.toThrow(/source branch/u);
  });
});
