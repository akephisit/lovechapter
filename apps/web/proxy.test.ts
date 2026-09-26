import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { proxyApiRequest } from "./lib/backend-proxy";
import { proxy } from "./proxy";

const proxySecret = Buffer.alloc(32, 7).toString("base64url");
const probeSecret = Buffer.alloc(32, 9).toString("base64url");

function request(path: string, method = "GET", probe?: string): NextRequest {
  return new NextRequest(`https://web.example.workers.dev${path}`, {
    method,
    ...(probe ? { headers: { "x-lovechapter-release-probe": probe } } : {}),
  });
}

describe("web release proxy", () => {
  beforeEach(() => {
    vi.stubEnv("API_UPSTREAM_ORIGIN", "https://api.example.workers.dev");
    vi.stubEnv("WEB_PROXY_SHARED_SECRET", proxySecret);
    vi.stubEnv("RELEASE_PROBE_SECRET", probeSecret);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("covers all user page families", async () => {
    const upstream = vi.fn<typeof fetch>(async () =>
      Response.json({ mode: "maintenance" }),
    );
    vi.stubGlobal("fetch", upstream);
    for (const path of [
      "/",
      "/sign-in",
      "/sign-up",
      "/forgot-password",
      "/verify-email",
      "/reset-password",
      "/i/private-invitation-token",
      "/api/v1/auth/session",
      "/api/v1/weddings/one/guests/export.csv",
    ]) {
      const response = await proxy(request(path));
      expect(response.status, path).toBe(503);
      expect(response.headers.get("cache-control"), path).toBe("no-store");
      expect(response.headers.get("retry-after"), path).toBe("60");
      if (path.startsWith("/api/")) {
        expect(response.headers.get("content-type")).toContain(
          "application/json",
        );
      } else {
        expect(response.headers.get("content-type")).toContain("text/html");
      }
    }
    expect(upstream).toHaveBeenCalledTimes(9);
  });

  it("fails closed on state fetch error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("API unavailable");
      }),
    );
    const response = await proxy(request("/i/private"));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects forged or mutating probes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ mode: "maintenance" })),
    );
    expect((await proxy(request("/sign-in", "GET", "forged"))).status).toBe(
      503,
    );
    expect(
      (await proxy(request("/api/v1/auth/sign-out", "POST", probeSecret)))
        .status,
    ).toBe(503);
    expect(
      (await proxy(request("/i/private", "GET", probeSecret))).status,
    ).toBe(200);
    expect(
      (await proxy(request("/i/private", "HEAD", probeSecret))).status,
    ).toBe(200);
  });

  it("continues when open and skips only maintenance-safe paths", async () => {
    const upstream = vi.fn(async () => Response.json({ mode: "open" }));
    vi.stubGlobal("fetch", upstream);
    expect((await proxy(request("/sign-in"))).status).toBe(200);
    expect(upstream).toHaveBeenCalledOnce();
    for (const path of [
      "/_next/static/chunk.js",
      "/icon.svg",
      "/sw.js",
      "/manifest.webmanifest",
      "/health/live",
    ]) {
      expect((await proxy(request(path))).status).toBe(200);
    }
    expect(upstream).toHaveBeenCalledOnce();
  });

  it("never forwards probe secret", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ mode: "maintenance" })),
    );
    const response = await proxy(request("/i/private", "GET", probeSecret));
    expect(JSON.stringify([...response.headers])).not.toContain(probeSecret);
    expect(response.headers.get("x-middleware-override-headers")).not.toContain(
      "x-lovechapter-release-probe",
    );
    const apiFetch = vi.fn<typeof fetch>(async (input) => {
      expect(
        (input as Request).headers.get("x-lovechapter-release-probe"),
      ).toBeNull();
      return Response.json({ status: "ok" });
    });
    await proxyApiRequest(
      request("/api/v1/auth/session", "GET", probeSecret),
      ["v1", "auth", "session"],
      {
        apiUpstreamOrigin: "https://api.example.workers.dev",
        proxySharedSecret: proxySecret,
        fetch: apiFetch,
      },
    );
    expect(apiFetch).toHaveBeenCalledOnce();
  });
});
