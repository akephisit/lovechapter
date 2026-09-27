import { describe, expect, it, vi } from "vitest";

import { runReleaseCli } from "./release-cli.mjs";

const sha = "a".repeat(40);

function environment(overrides = {}) {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "push",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REF_PROTECTED: "true",
    GITHUB_REPOSITORY: "akephisit/lovechapter",
    GITHUB_SHA: sha,
    RELEASE_ENVIRONMENT: "production",
    PRODUCTION_RELEASE_ENABLED: "true",
    ...overrides,
  };
}

describe("release CLI admission", () => {
  it("rejects direct invocation, wrong event, ref, SHA, environment and disabled jobs before loading driver", async () => {
    for (const [args, env] of [
      [["production"], environment({ GITHUB_ACTIONS: "false" })],
      [["production"], environment({ GITHUB_EVENT_NAME: "pull_request" })],
      [["production"], environment({ GITHUB_REF: "refs/heads/feature" })],
      [["production"], environment({ GITHUB_REF_PROTECTED: "false" })],
      [["production"], environment({ GITHUB_SHA: "short" })],
      [["production"], environment({ PRODUCTION_RELEASE_ENABLED: "false" })],
      [["staging"], environment({ RELEASE_ENVIRONMENT: "staging" })],
    ]) {
      const factory = vi.fn();
      await expect(
        runReleaseCli(args, env, { driverFactory: factory }),
      ).rejects.toThrow();
      expect(factory).not.toHaveBeenCalled();
    }
  });

  it("accepts an exact protected main SHA without staging evidence", async () => {
    const factory = vi.fn(async () => ({ result: "accepted" }));
    await expect(
      runReleaseCli(["production"], environment(), { driverFactory: factory }),
    ).resolves.toEqual({ result: "accepted" });
    expect(factory).toHaveBeenCalledWith(
      { environment: "production", sha },
      expect.any(Object),
    );
  });

  it("passes the selected environment and exact SHA to the injected release driver", async () => {
    const driverFactory = vi.fn(async () => ({ result: "accepted" }));
    const result = await runReleaseCli(["production"], environment(), {
      driverFactory,
    });
    expect(result).toEqual({ result: "accepted" });
    expect(driverFactory).toHaveBeenCalledWith(
      { environment: "production", sha },
      expect.any(Object),
    );
  });

  it("keeps the default production path closed without complete environment setup", async () => {
    await expect(
      runReleaseCli(["production"], environment()),
    ).rejects.toThrow();
  });
});
