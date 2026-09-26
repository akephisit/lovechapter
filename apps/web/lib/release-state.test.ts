import { describe, expect, it, vi } from "vitest";

import { fetchReleaseMode } from "./release-state";

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
      return Response.json({ mode: "maintenance" });
    });
    await expect(
      fetchReleaseMode("https://web.example.workers.dev/i/private", {
        apiUpstreamOrigin: "https://api.example.workers.dev",
        proxySharedSecret: secret,
        fetch: upstream,
      }),
    ).resolves.toBe("maintenance");
    expect(upstream).toHaveBeenCalledOnce();
  });

  it.each([
    { mode: "paused" },
    { mode: "open", leases: [] },
    { mode: null },
    null,
  ])("rejects unexpected release-state payload %j", async (body) => {
    await expect(
      fetchReleaseMode("https://web.example.workers.dev/", {
        apiUpstreamOrigin: "https://api.example.workers.dev",
        proxySharedSecret: secret,
        fetch: vi.fn(async () => Response.json(body)),
      }),
    ).rejects.toThrow();
  });

  it("rejects a same-origin or invalid upstream before fetching", async () => {
    const upstream = vi.fn<typeof fetch>();
    await expect(
      fetchReleaseMode("https://web.example.workers.dev/", {
        apiUpstreamOrigin: "https://web.example.workers.dev",
        proxySharedSecret: secret,
        fetch: upstream,
      }),
    ).rejects.toThrow();
    expect(upstream).not.toHaveBeenCalled();
  });
});
