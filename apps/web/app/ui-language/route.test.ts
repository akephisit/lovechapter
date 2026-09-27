import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

const origin = "https://web.example.workers.dev";

function request(body: BodyInit, contentType: string, source = origin) {
  return new Request(`${origin}/ui-language`, {
    method: "POST",
    headers: { origin: source, "content-type": contentType },
    body,
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("language preference route", () => {
  it("sets a bounded HttpOnly preference cookie without exposing a URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await POST(
      request(JSON.stringify({ language: "th" }), "application/json"),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("lc_ui_language=th");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(response.headers.get("set-cookie")).toContain("Path=/");
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=\d+/u);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects invalid language and cross-origin requests", async () => {
    expect(
      (
        await POST(
          request(JSON.stringify({ language: "fr" }), "application/json"),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await POST(
          request(
            JSON.stringify({ language: "th" }),
            "application/json",
            "https://attacker.example",
          ),
        )
      ).status,
    ).toBe(403);
  });

  it("lets the no-script maintenance form change language safely", async () => {
    const response = await POST(
      request("language=th", "application/x-www-form-urlencoded"),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${origin}/`);
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
