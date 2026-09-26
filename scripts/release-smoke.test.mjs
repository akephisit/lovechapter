import { Buffer } from "node:buffer";
import { URL } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { runPrivateReleaseSmoke } from "./release-smoke.mjs";

const sha = "a".repeat(40);
const closure = {
  mode: "maintenance",
  targetSha: sha,
  changedAt: "2026-09-26T00:00:00.000Z",
};
const input = {
  sha,
  closure,
  webOrigin: "https://lovechapter-web-staging.example.workers.dev",
  apiOrigin: "https://lovechapter-api-staging.example.workers.dev",
  proxySecret: Buffer.alloc(32, 1).toString("base64url"),
  probeSecret: Buffer.alloc(32, 2).toString("base64url"),
  deployed: {
    web: { versionId: "web-v1", sourceSha: sha },
    api: { versionId: "api-v1", sourceSha: sha },
  },
};

function mockFetch(overrides = {}) {
  const calls = [];
  const fetcher = vi.fn(async (url, options = {}) => {
    const path = new URL(url).pathname;
    const headers = new globalThis.Headers(options.headers);
    const component = new URL(url).hostname.includes("-web-") ? "web" : "api";
    calls.push({ component, path, method: options.method ?? "GET", headers });
    const key = `${component}:${options.method ?? "GET"}:${path}:${headers.has("x-lovechapter-release-probe") ? "probe" : "plain"}`;
    if (overrides[key]) return overrides[key];
    if (component === "api" && path === "/health/release-state") {
      return globalThis.Response.json({ mode: "maintenance" });
    }
    if (component === "api" && path === "/health/ready") {
      return globalThis.Response.json({ status: "ok" });
    }
    if (component === "api" && path === "/health/live") {
      return globalThis.Response.json({ status: "ok" });
    }
    if (component === "api" && !headers.has("x-lovechapter-proxy-secret")) {
      return globalThis.Response.json(
        { error: { code: "request_ingress_rejected" } },
        { status: 403 },
      );
    }
    if (
      component === "web" &&
      path === "/sign-in" &&
      headers.has("x-lovechapter-release-probe")
    ) {
      return new globalThis.Response("<html>Sign in</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (component === "web" && path === "/sign-in") {
      return new globalThis.Response("<html>Maintenance</html>", {
        status: 503,
        headers: { "content-type": "text/html" },
      });
    }
    return globalThis.Response.json(
      { error: { code: "maintenance" } },
      { status: 503 },
    );
  });
  return { fetcher, calls };
}

describe("closed-gate private release smoke", () => {
  it("proves whole-site closure, protected readiness, private presentation and blocked API writes", async () => {
    const { fetcher, calls } = mockFetch();
    const result = await runPrivateReleaseSmoke(input, {
      fetcher,
      now: () => new Date("2026-09-26T00:01:00.000Z"),
    });
    expect(result).toEqual({
      passed: true,
      acceptedAt: "2026-09-26T00:01:00.000Z",
    });
    expect(
      calls.map(
        ({ component, method, path }) => `${component}:${method}:${path}`,
      ),
    ).toEqual([
      "api:GET:/health/live",
      "api:GET:/health/ready",
      "api:GET:/health/release-state",
      "api:GET:/v1/auth/session",
      "api:POST:/v1/auth/forgot-password",
      "web:GET:/sign-in",
      "web:GET:/sign-in",
      "web:GET:/api/v1/auth/session",
      "web:POST:/api/v1/auth/forgot-password",
      "api:GET:/health/release-state",
    ]);
    expect(
      calls.filter(({ headers }) => headers.has("x-lovechapter-release-probe")),
    ).toHaveLength(2);
    expect(
      calls
        .find(
          ({ component, path }) =>
            component === "api" && path === "/health/ready",
        )
        .headers.get("x-lovechapter-proxy-secret"),
    ).toBe(input.proxySecret);
    expect(
      calls
        .find(
          ({ component, path }) =>
            component === "api" && path === "/v1/auth/session",
        )
        .headers.has("x-lovechapter-proxy-secret"),
    ).toBe(false);
    expect(
      calls
        .filter(({ method }) => method === "POST")
        .every(({ path }) => path.endsWith("forgot-password")),
    ).toBe(true);
  });

  it("rejects an unexpectedly open API or a probe that bypasses business API closure", async () => {
    for (const overrides of [
      {
        "api:GET:/health/release-state:plain": globalThis.Response.json({
          mode: "open",
        }),
      },
      {
        "web:GET:/api/v1/auth/session:probe": globalThis.Response.json(
          { user: null },
          { status: 200 },
        ),
      },
      {
        "web:GET:/sign-in:probe": globalThis.Response.json(
          { status: "ok" },
          { status: 200 },
        ),
      },
      {
        "api:POST:/v1/auth/forgot-password:plain": globalThis.Response.json(
          {},
          { status: 202 },
        ),
      },
    ]) {
      const { fetcher } = mockFetch(overrides);
      await expect(runPrivateReleaseSmoke(input, { fetcher })).rejects.toThrow(
        /private release smoke failed/iu,
      );
    }
  });

  it("rejects wrong origins, reused secrets, invalid evidence and stale acceptance time before sending", async () => {
    const { fetcher } = mockFetch();
    for (const bad of [
      { webOrigin: "https://lovechapter-web.example.com" },
      { apiOrigin: input.webOrigin },
      { probeSecret: input.proxySecret },
      {
        deployed: {
          ...input.deployed,
          api: { versionId: "api-v1", sourceSha: "invalid" },
        },
      },
      { closure: { ...closure, mode: "open" } },
    ]) {
      await expect(
        runPrivateReleaseSmoke({ ...input, ...bad }, { fetcher }),
      ).rejects.toThrow();
    }
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      runPrivateReleaseSmoke(input, {
        fetcher,
        now: () => new Date(closure.changedAt),
      }),
    ).rejects.toThrow(/private release smoke failed/iu);
  });

  it("never includes credentials or provider bodies in errors", async () => {
    const { fetcher } = mockFetch({
      "api:GET:/health/live:plain": new globalThis.Response(input.proxySecret, {
        status: 500,
      }),
    });
    let error;
    try {
      await runPrivateReleaseSmoke(input, { fetcher });
    } catch (caught) {
      error = caught;
    }
    expect(error?.message).toMatch(/private release smoke failed/iu);
    expect(error?.message).not.toContain(input.proxySecret);
    expect(error?.message).not.toContain(input.probeSecret);
  });
});
