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
    RELEASE_ENVIRONMENT: "staging",
    STAGING_RELEASE_ENABLED: "true",
    ...overrides,
  };
}

describe("release CLI admission", () => {
  it("rejects direct invocation, wrong event, ref, SHA, environment and disabled jobs before loading driver", async () => {
    for (const [args, env] of [
      [["staging"], environment({ GITHUB_ACTIONS: "false" })],
      [["staging"], environment({ GITHUB_EVENT_NAME: "pull_request" })],
      [["staging"], environment({ GITHUB_REF: "refs/heads/feature" })],
      [["staging"], environment({ GITHUB_REF_PROTECTED: "false" })],
      [["staging"], environment({ GITHUB_SHA: "short" })],
      [["production"], environment()],
      [["staging"], environment({ STAGING_RELEASE_ENABLED: "false" })],
    ]) {
      const factory = vi.fn();
      await expect(
        runReleaseCli(args, env, { driverFactory: factory }),
      ).rejects.toThrow();
      expect(factory).not.toHaveBeenCalled();
    }
  });

  it("requires exact-SHA staging evidence for production and keeps default off", async () => {
    const factory = vi.fn();
    await expect(
      runReleaseCli(
        ["production"],
        environment({
          RELEASE_ENVIRONMENT: "production",
          PRODUCTION_RELEASE_ENABLED: "true",
          RELEASE_STAGING_SHA: "b".repeat(40),
        }),
        { driverFactory: factory },
      ),
    ).rejects.toThrow(/staging/iu);
    expect(factory).not.toHaveBeenCalled();
  });

  it("passes the selected environment and exact SHA to the injected release driver", async () => {
    const driverFactory = vi.fn(async () => ({ result: "accepted" }));
    const result = await runReleaseCli(["staging"], environment(), {
      driverFactory,
    });
    expect(result).toEqual({ result: "accepted" });
    expect(driverFactory).toHaveBeenCalledWith(
      { environment: "staging", sha },
      expect.any(Object),
    );
  });
});
