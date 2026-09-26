import { describe, expect, it, vi } from "vitest";

import { createGitHubReadClient } from "./github-release-client.mjs";

const sha = "a".repeat(40);

describe("GitHub release source read", () => {
  it("reads the current main commit from the authenticated exact repository ref", async () => {
    const fetcher = vi.fn(
      async () =>
        new globalThis.Response(
          JSON.stringify({
            ref: "refs/heads/main",
            object: { type: "commit", sha },
          }),
          { status: 200 },
        ),
    );
    const client = createGitHubReadClient({
      token: "private-test-token",
      fetcher,
    });
    await expect(client.readMainHead()).resolves.toBe(sha);
    expect(fetcher).toHaveBeenCalledWith(
      "https://api.github.com/repos/akephisit/lovechapter/git/ref/heads/main",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer private-test-token",
        }),
      }),
    );
  });

  it("rejects unavailable or malformed head data without leaking provider output", async () => {
    for (const response of [
      new globalThis.Response("token: private-test-token", { status: 403 }),
      new globalThis.Response(
        JSON.stringify({
          ref: "refs/heads/feature",
          object: { type: "commit", sha },
        }),
        { status: 200 },
      ),
      new globalThis.Response(
        JSON.stringify({
          ref: "refs/heads/main",
          object: { type: "tag", sha },
        }),
        { status: 200 },
      ),
      new globalThis.Response(
        JSON.stringify({
          ref: "refs/heads/main",
          object: { type: "commit", sha: "short" },
        }),
        { status: 200 },
      ),
    ]) {
      const client = createGitHubReadClient({
        token: "private-test-token",
        fetcher: vi.fn(async () => response),
      });
      await expect(client.readMainHead()).rejects.toThrow(
        "GitHub main ref unavailable",
      );
    }
  });

  it("requires a token before any network request", () => {
    const fetcher = vi.fn();
    expect(() => createGitHubReadClient({ token: "", fetcher })).toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
