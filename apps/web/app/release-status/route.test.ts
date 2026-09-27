import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "./route";

const secret = Buffer.alloc(32, 7).toString("base64url");
const sha = "a".repeat(40);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("same-origin release status", () => {
  it("uses the private API ingress and returns only the published state", async () => {
    vi.stubEnv("API_UPSTREAM_ORIGIN", "https://api.example.workers.dev");
    vi.stubEnv("WEB_PROXY_SHARED_SECRET", secret);
    const upstream = vi.fn<typeof fetch>(async (input) => {
      const request = input as Request;
      expect(request.url).toBe(
        "https://api.example.workers.dev/health/release-state",
      );
      expect(request.headers.get("x-lovechapter-proxy-secret")).toBe(secret);
      return Response.json({ mode: "open", publishedSha: sha });
    });
    vi.stubGlobal("fetch", upstream);
    const response = await GET(
      new Request("https://web.example.workers.dev/release-status"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      mode: "open",
      publishedSha: sha,
    });
  });

  it("returns maintenance without a candidate SHA and fails closed on API outage", async () => {
    vi.stubEnv("API_UPSTREAM_ORIGIN", "https://api.example.workers.dev");
    vi.stubEnv("WEB_PROXY_SHARED_SECRET", secret);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ mode: "maintenance", publishedSha: null }),
      ),
    );
    const closed = await GET(
      new Request("https://web.example.workers.dev/release-status"),
    );
    await expect(closed.json()).resolves.toEqual({
      mode: "maintenance",
      publishedSha: null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("down");
      }),
    );
    const unavailable = await GET(
      new Request("https://web.example.workers.dev/release-status"),
    );
    expect(unavailable.status).toBe(503);
    expect(unavailable.headers.get("cache-control")).toBe("no-store");
  });
});
