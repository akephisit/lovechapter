import { describe, expect, it, vi } from "vitest";

import { proxyApiRequest, type ProxyEnvironment } from "./backend-proxy";

const secret = Buffer.alloc(32, 7).toString("base64url");

describe("same-origin backend proxy", () => {
  it("passes safe CSV download headers while forcing no-store", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("name\r\n", {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition":
              'attachment; filename="lovechapter-guests.csv"',
            "cache-control": "public",
          },
        }),
    );
    const response = await proxyApiRequest(
      new Request(
        "https://web.example.test/api/v1/weddings/one/guests/export.csv",
      ),
      ["v1", "weddings", "one", "guests", "export.csv"],
      environment(fetchMock),
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="lovechapter-guests.csv"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("forwards only allowlisted browser headers and trusted proxy metadata", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const request = input as Request;
      expect(request.url).toBe(
        "https://api-origin.example.test/v1/auth/session?fresh=1",
      );
      expect(request.headers.get("x-lovechapter-proxy-secret")).toBe(secret);
      expect(request.headers.get("x-lovechapter-client-address")).toBe(
        "203.0.113.7",
      );
      expect(request.headers.get("cookie")).toBe("session=browser-cookie");
      expect(request.headers.get("x-user-id")).toBeNull();
      expect(request.headers.get("connection")).toBeNull();
      expect(request.redirect).toBe("manual");
      const headers = new Headers({
        "content-type": "application/json",
        "cache-control": "private",
        connection: "keep-alive",
      });
      headers.append(
        "set-cookie",
        "__Host-lovechapter_session=abc; Path=/; Secure; HttpOnly",
      );
      return new Response('{"user":{}}', { status: 200, headers });
    });
    const request = new Request(
      "https://web.example.test/api/v1/auth/session?fresh=1",
      {
        headers: {
          accept: "application/json",
          cookie: "session=browser-cookie",
          "cf-connecting-ip": "203.0.113.7",
          "x-lovechapter-proxy-secret": "browser-spoof",
          "x-lovechapter-client-address": "198.51.100.9",
          "x-user-id": "spoofed-user",
          connection: "close",
        },
      },
    );

    const response = await proxyApiRequest(
      request,
      ["v1", "auth", "session"],
      environment(fetchMock),
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain(
      "__Host-lovechapter_session",
    );
    expect(response.headers.get("connection")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("uses a fixed development address when Cloudflare metadata is absent", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const request = input as Request;
      expect(request.headers.get("x-lovechapter-client-address")).toBe(
        "local-development",
      );
      return new Response(null, { status: 204 });
    });

    await proxyApiRequest(
      new Request("http://localhost:3000/api/v1/auth/sign-out", {
        method: "POST",
        headers: {
          origin: "http://localhost:3000",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      ["v1", "auth", "sign-out"],
      environment(fetchMock),
    );
  });

  it.each([[".."], ["."], ["%2e%2e"], ["v1/auth"], ["v1\\auth"]])(
    "rejects a traversal-capable path segment %s",
    async (segment) => {
      const fetchMock = vi.fn();

      const response = await proxyApiRequest(
        new Request("https://web.example.test/api/invalid"),
        [segment],
        environment(fetchMock),
      );

      expect(response.status).toBe(400);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["API_UPSTREAM_ORIGIN", { apiUpstreamOrigin: "not-a-url" }],
    [
      "API_UPSTREAM_ORIGIN",
      { apiUpstreamOrigin: "http://api-origin.example.test" },
    ],
    ["WEB_PROXY_SHARED_SECRET", { proxySharedSecret: "" }],
  ] as const)("rejects invalid %s configuration", async (name, override) => {
    await expect(
      proxyApiRequest(
        new Request("https://web.example.test/api/v1/me"),
        ["v1", "me"],
        { ...environment(vi.fn()), ...override },
      ),
    ).rejects.toThrow(name);
  });

  it("rejects unsupported methods without contacting upstream", async () => {
    const fetchMock = vi.fn();
    const response = await proxyApiRequest(
      new Request("https://web.example.test/api/v1/me", { method: "HEAD" }),
      ["v1", "me"],
      environment(fetchMock),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe(
      "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized streaming body", async () => {
    const fetchMock = vi.fn();
    const response = await proxyApiRequest(
      new Request("https://web.example.test/api/v1/auth/sign-in", {
        method: "POST",
        headers: {
          origin: "https://web.example.test",
          "content-type": "application/json",
        },
        body: "x".repeat(1_048_577),
      }),
      ["v1", "auth", "sign-in"],
      environment(fetchMock),
    );

    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards Retry-After but strips hop-by-hop and private headers", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response('{"error":{}}', {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": "15",
            connection: "close",
            "x-provider-detail": "private",
          },
        }),
    );

    const response = await proxyApiRequest(
      new Request("https://web.example.test/api/v1/auth/sign-in"),
      ["v1", "auth", "sign-in"],
      environment(fetchMock),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("15");
    expect(response.headers.get("connection")).toBeNull();
    expect(response.headers.get("x-provider-detail")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("allows a loopback HTTP upstream for local development", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      expect((input as Request).url).toBe("http://127.0.0.1:3001/v1/me");
      return new Response(null, { status: 204 });
    });

    await proxyApiRequest(
      new Request("http://localhost:3000/api/v1/me"),
      ["v1", "me"],
      {
        ...environment(fetchMock),
        apiUpstreamOrigin: "http://127.0.0.1:3001",
      },
    );
  });
});

function environment(
  fetchImplementation: ProxyEnvironment["fetch"],
): ProxyEnvironment {
  return {
    apiUpstreamOrigin: "https://api-origin.example.test",
    proxySharedSecret: secret,
    fetch: fetchImplementation,
  };
}
