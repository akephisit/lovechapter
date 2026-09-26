import { describe, expect, it } from "vitest";

import { maintenanceResponse } from "./maintenance-response";

describe("web maintenance response", () => {
  it("serves self-contained no-store HTML for a page", async () => {
    const response = maintenanceResponse("/i/private-token", "GET");
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("retry-after")).toBe("60");
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("LoveChapter");
    expect(html).toContain("temporarily unavailable");
    expect(html).not.toMatch(/<script|<link|<img|url\(/iu);
  });

  it("uses JSON for API requests and no body for HEAD", async () => {
    const api = maintenanceResponse("/api/v1/auth/session", "GET");
    expect(api.status).toBe(503);
    expect(api.headers.get("cache-control")).toBe("no-store");
    expect(api.headers.get("retry-after")).toBe("60");
    expect(api.headers.get("content-type")).toContain("application/json");
    await expect(api.json()).resolves.toEqual({
      error: {
        code: "maintenance",
        message: "Service temporarily unavailable",
      },
    });
    const head = maintenanceResponse("/", "HEAD");
    expect(head.status).toBe(503);
    expect(head.body).toBeNull();
  });
});
