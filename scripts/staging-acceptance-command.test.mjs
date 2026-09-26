import { describe, expect, it, vi } from "vitest";

import { REQUIRED_STAGING_CHECKS } from "./release-orchestrator.mjs";
import {
  createStagingAcceptanceCommand,
  createStagingAcceptancePreflightCommand,
} from "./staging-acceptance-command.mjs";

const sha = "a".repeat(40);
const report = {
  commitSha: sha,
  checks: [...REQUIRED_STAGING_CHECKS],
  inboxDelivery: "waived",
};

describe("staging acceptance subprocess", () => {
  it("preflights provider targets before any Worker preparation", async () => {
    const runFile = vi.fn(async () => ({ stdout: '{"targetVerified":true}' }));
    const preflight = createStagingAcceptancePreflightCommand({
      env: { RELEASE_ENVIRONMENT: "staging" },
      runFile,
    });
    await expect(preflight(sha)).resolves.toEqual({ targetVerified: true });
    expect(runFile).toHaveBeenCalledWith(
      "bun",
      [
        expect.stringMatching(/staging-acceptance-cli\.mjs$/u),
        sha,
        "--preflight",
      ],
      expect.any(Object),
    );
  });

  it("runs the Bun CLI and accepts only its exact projected report", async () => {
    const runFile = vi.fn(async () => ({ stdout: JSON.stringify(report) }));
    const accept = createStagingAcceptanceCommand({
      env: { RELEASE_ENVIRONMENT: "staging" },
      runFile,
    });
    await expect(accept(sha)).resolves.toEqual(report);
    expect(runFile).toHaveBeenCalledWith(
      "bun",
      [expect.stringMatching(/staging-acceptance-cli\.mjs$/u), sha],
      expect.objectContaining({ env: { RELEASE_ENVIRONMENT: "staging" } }),
    );
  });

  it("rejects malformed output and redacts provider errors", async () => {
    const badOutput = createStagingAcceptanceCommand({
      env: { RELEASE_ENVIRONMENT: "staging" },
      runFile: vi.fn(async () => ({
        stdout: JSON.stringify({ ...report, checks: [] }),
      })),
    });
    await expect(badOutput(sha)).rejects.toThrow(
      "Staging acceptance command failed",
    );

    const providerError = createStagingAcceptanceCommand({
      env: {
        RELEASE_ENVIRONMENT: "staging",
        RELEASE_DATABASE_URL: "private-password",
      },
      runFile: vi.fn(async () => {
        throw new Error("private-password provider body");
      }),
    });
    await expect(providerError(sha)).rejects.toThrow(
      "Staging acceptance command failed",
    );
  });
});
