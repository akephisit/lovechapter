import { describe, expect, it, vi } from "vitest";

import { fetchReleaseState } from "./release-state";

const secret = Buffer.alloc(32, 7).toString("base64url");

describe("private release state", () => {
  it("uses only the configured API origin and proxy credential", async () => {
    const upstream = vi.fn<typeof fetch>(async (input) => {
      const request = input as Request;
      expect(request.url).toBe(
        "https://api.example.workers.dev/health/release-state",
      );
      expect(request.method).toBe("GET");
      expect(request.redirect).toBe("manual");
      expect(request.headers.get("x-lovechapter-proxy-secret")).toBe(secret);
      expect(request.headers.get("cache-control")).toBe("no-store");
      expect(request.headers.get("x-lovechapter-release-probe")).toBeNull();
      return Response.json({ mode: "maintenance", publishedSha: null });
    });
    await expect(
      fetchReleaseState("https://web.example.workers.dev/i/private", {
        apiUpstreamOrigin: "https://api.example.workers.dev",
        proxySharedSecret: secret,
        fetch: upstream,
      }),
    ).resolves.toEqual({ mode: "maintenance", publishedSha: null });
    expect(upstream).toHaveBeenCalledOnce();
  });

  it.each([
    { mode: "paused", publishedSha: null },
    { mode: "open", publishedSha: "short" },
    { mode: "open", publishedSha: null, leases: [] },
    { mode: "maintenance", publishedSha: "a".repeat(40) },
    { mode: null, publishedSha: null },
    null,
  ])("rejects unexpected release-state payload %j", async (body) => {
    await expect(
      fetchReleaseState("https://web.example.workers.dev/", {
        apiUpstreamOrigin: "https://api.example.workers.dev",
        proxySharedSecret: secret,
        fetch: vi.fn(async () => Response.json(body)),
      }),
    ).rejects.toThrow();
  });

  it("rejects a same-origin or invalid upstream before fetching", async () => {
    const upstream = vi.fn<typeof fetch>();
    await expect(
      fetchReleaseState("https://web.example.workers.dev/", {
        apiUpstreamOrigin: "https://web.example.workers.dev",
        proxySharedSecret: secret,
        fetch: upstream,
      }),
    ).rejects.toThrow();
    expect(upstream).not.toHaveBeenCalled();
  });

  it("times out a release-state request that never responds", async () => {
    vi.useFakeTimers();
    try {
      let request: Request | undefined;
      const pending = fetchReleaseState("https://web.example.workers.dev/", {
        apiUpstreamOrigin: "https://api.example.workers.dev",
        proxySharedSecret: secret,
        fetch: vi.fn((input) => {
          request = input as Request;
          return new Promise<Response>(() => undefined);
        }),
      });
      const rejected = expect(pending).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(3_000);
      await rejected;
      expect(request?.signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("times out when the release-state response body never completes", async () => {
    vi.useFakeTimers();
    try {
      const pending = fetchReleaseState("https://web.example.workers.dev/", {
        apiUpstreamOrigin: "https://api.example.workers.dev",
        proxySharedSecret: secret,
        fetch: vi.fn(
          async () =>
            new Response(new ReadableStream({ start: () => undefined }), {
              headers: { "content-type": "application/json" },
            }),
        ),
      });
      const rejected = expect(pending).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(3_000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
});
