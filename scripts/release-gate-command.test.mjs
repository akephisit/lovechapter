import { describe, expect, it, vi } from "vitest";

import { createReleaseGateCommand } from "./release-gate-command.mjs";

const sha = "a".repeat(40);
const web = { versionId: "web-v1", sourceSha: sha };
const api = { versionId: "api-v1", sourceSha: sha };
const closed = {
  mode: "maintenance",
  targetSha: sha,
  changedAt: "2026-09-26T06:00:00.000Z",
  activeCount: 0,
  web,
  api,
};

describe("release gate command adapter", () => {
  it("reads verified CLI status after close and drain with the exact SHA", async () => {
    const calls = [];
    const runFile = vi.fn(async (executable, args, options) => {
      calls.push({ executable, args, options });
      return {
        stdout: JSON.stringify(
          args[1] === "status"
            ? closed
            : { mode: "maintenance", targetSha: sha },
        ),
      };
    });
    const gate = createReleaseGateCommand({
      env: { RELEASE_ENVIRONMENT: "staging" },
      runFile,
    });
    await expect(gate.close(sha)).resolves.toEqual(closed);
    await expect(gate.drain(sha)).resolves.toEqual(closed);
    expect(calls.map(({ args }) => args[1])).toEqual([
      "close",
      "status",
      "drain",
      "status",
    ]);
    expect(calls[0].args).toEqual([
      expect.stringMatching(/release-gate-cli\.ts$/u),
      "close",
      "--sha",
      sha,
    ]);
    expect(calls[0].options.env.RELEASE_ENVIRONMENT).toBe("staging");
  });

  it("rejects a stale or non-drained closure without claiming maintenance is ready", async () => {
    for (const state of [
      { ...closed, targetSha: "b".repeat(40) },
      { ...closed, activeCount: 1 },
      { ...closed, changedAt: "bad" },
    ]) {
      const gate = createReleaseGateCommand({
        env: { RELEASE_ENVIRONMENT: "staging" },
        runFile: vi.fn(async (_executable, args) => ({
          stdout: JSON.stringify(args[1] === "status" ? state : {}),
        })),
      });
      await expect(gate.drain(sha)).rejects.toThrow();
    }
  });

  it("does not leak command output or a database URL on failure", async () => {
    const gate = createReleaseGateCommand({
      env: {
        RELEASE_ENVIRONMENT: "staging",
        RELEASE_DATABASE_URL: "postgres://role:private-password@host/db",
      },
      runFile: vi.fn(async () => {
        throw new Error("private-password provider details");
      }),
    });
    await expect(gate.status()).rejects.toThrow("Release gate command failed");
  });

  it("writes reopen evidence to a temporary file and removes it after the CLI returns", async () => {
    let evidencePath;
    const runFile = vi.fn(async (_executable, args) => {
      if (args[1] === "open") {
        evidencePath = args[5];
        const { readFileSync } = await import("node:fs");
        expect(JSON.parse(readFileSync(evidencePath, "utf8")).commitSha).toBe(
          sha,
        );
      }
      return {
        stdout: JSON.stringify(
          args[1] === "status" ? { ...closed, mode: "open" } : {},
        ),
      };
    });
    const gate = createReleaseGateCommand({
      env: { RELEASE_ENVIRONMENT: "staging" },
      runFile,
    });
    await expect(gate.open(sha, { commitSha: sha })).resolves.toMatchObject({
      mode: "open",
      targetSha: sha,
    });
    const { existsSync } = await import("node:fs");
    expect(existsSync(evidencePath)).toBe(false);
  });
});
