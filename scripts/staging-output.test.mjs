import { describe, expect, it, vi } from "vitest";

import { parseStagingOutput, writeStagingOutput } from "./staging-output.mjs";
import { REQUIRED_STAGING_CHECKS } from "./release-orchestrator.mjs";

const sha = "a".repeat(40);
const acceptance = {
  commitSha: sha,
  checks: [...REQUIRED_STAGING_CHECKS],
  inboxDelivery: "waived",
};

describe("same-run staging handoff", () => {
  it("writes only the exact accepted SHA and named checks", async () => {
    const appendOutput = vi.fn(async () => undefined);
    await writeStagingOutput(
      {
        status: "released",
        environment: "staging",
        sha,
        recorded: {
          stagingAcceptance: {
            ...acceptance,
            privatePassword: "sentinel-private-password",
          },
        },
      },
      "/tmp/github-output-test",
      appendOutput,
    );
    const [path, output] = appendOutput.mock.calls[0];
    expect(path).toBe("/tmp/github-output-test");
    expect(output).toContain(`accepted_sha=${sha}\n`);
    expect(output).toContain("acceptance=");
    expect(output).not.toContain("sentinel-private-password");
    const encoded = output.split("acceptance=")[1].trim();
    expect(parseStagingOutput(encoded, sha)).toEqual(acceptance);
  });

  it("rejects skipped, wrong-SHA, incomplete, or claimed inbox delivery", async () => {
    for (const report of [
      {
        status: "skipped",
        environment: "staging",
        sha,
        recorded: { stagingAcceptance: acceptance },
      },
      {
        status: "released",
        environment: "staging",
        sha,
        recorded: {
          stagingAcceptance: { ...acceptance, commitSha: "b".repeat(40) },
        },
      },
      {
        status: "released",
        environment: "staging",
        sha,
        recorded: {
          stagingAcceptance: {
            ...acceptance,
            checks: acceptance.checks.slice(1),
          },
        },
      },
      {
        status: "released",
        environment: "staging",
        sha,
        recorded: {
          stagingAcceptance: { ...acceptance, inboxDelivery: "passed" },
        },
      },
    ]) {
      const appendOutput = vi.fn();
      await expect(
        writeStagingOutput(report, "/tmp/output", appendOutput),
      ).rejects.toThrow();
      expect(appendOutput).not.toHaveBeenCalled();
    }
  });

  it("rejects malformed production handoff rather than inventing checks", () => {
    for (const encoded of [
      "{}",
      "not-json",
      JSON.stringify({ ...acceptance, checks: acceptance.checks.slice(1) }),
      JSON.stringify({ ...acceptance, inboxDelivery: "passed" }),
    ]) {
      expect(() => parseStagingOutput(encoded, sha)).toThrow();
    }
  });
});
