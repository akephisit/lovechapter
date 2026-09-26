import { describe, expect, it, vi } from "vitest";

import { createReleaseMigrationCommand } from "./release-migration-command.mjs";

const sha = "a".repeat(40);
const closedAt = "2026-09-26 06:00:00+00";
const migration = {
  kind: "nonbreaking",
  paths: ["packages/database/drizzle/0011_release_versions.sql"],
};

describe("release migration command adapter", () => {
  it("passes reviewed paths and exact closure to the separate migration CLI", async () => {
    const runFile = vi.fn(async () => ({
      stdout: JSON.stringify({ status: "applied_and_validated" }),
    }));
    const command = createReleaseMigrationCommand({
      env: { RELEASE_ENVIRONMENT: "staging" },
      runFile,
    });
    await expect(
      command(sha, { migration, closure: { changedAt: closedAt } }),
    ).resolves.toEqual({ status: "applied_and_validated" });
    expect(runFile).toHaveBeenCalledWith(
      "bun",
      [
        expect.stringMatching(/release-migration-cli\.ts$/u),
        "--sha",
        sha,
        "--closed-at",
        closedAt,
        "--reviewed",
        migration.paths[0],
      ],
      expect.objectContaining({
        env: { RELEASE_ENVIRONMENT: "staging" },
      }),
    );
  });

  it("rejects empty review, stale closure, and unexpected CLI output", async () => {
    const runFile = vi.fn(async () => ({ stdout: "{}" }));
    const command = createReleaseMigrationCommand({
      env: { RELEASE_ENVIRONMENT: "staging" },
      runFile,
    });
    for (const context of [
      {
        migration: { kind: "none", paths: [] },
        closure: { changedAt: closedAt },
      },
      { migration, closure: { changedAt: "invalid" } },
    ]) {
      await expect(command(sha, context)).rejects.toThrow();
    }
    expect(runFile).not.toHaveBeenCalled();
    await expect(
      command(sha, { migration, closure: { changedAt: closedAt } }),
    ).rejects.toThrow();
  });

  it("redacts child-process/provider errors", async () => {
    const command = createReleaseMigrationCommand({
      env: {
        RELEASE_ENVIRONMENT: "production",
        RELEASE_MIGRATION_DATABASE_URL:
          "postgresql://migrator:private-password@host/db",
      },
      runFile: vi.fn(async () => {
        throw new Error("private-password provider body");
      }),
    });
    await expect(
      command(sha, { migration, closure: { changedAt: closedAt } }),
    ).rejects.toThrow("Release migration command failed");
  });
});
