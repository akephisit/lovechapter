import { describe, expect, it } from "vitest";

import {
  expireSessionCookie,
  readSessionCookie,
  serializeSessionCookie,
} from "./session-cookie";

const token = "a".repeat(43);
const expiresAt = new Date("2026-10-22T12:00:00.000Z");

describe("local session cookie", () => {
  it("uses a hardened __Host cookie in production", () => {
    const cookie = serializeSessionCookie(token, expiresAt, "production");

    expect(cookie).toContain(`__Host-lovechapter_session=${token}`);
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Domain=");
  });

  it("uses a distinct non-Secure cookie for local development", () => {
    const cookie = serializeSessionCookie(token, expiresAt, "development");

    expect(cookie).toContain(`lovechapter_dev_session=${token}`);
    expect(cookie).not.toContain("Secure");
  });

  it("reads only the cookie name selected for the environment", () => {
    const request = new Request("https://api.example.test/v1/auth/session", {
      headers: {
        cookie: `lovechapter_dev_session=${token}; __Host-lovechapter_session=${"b".repeat(43)}`,
      },
    });

    expect(readSessionCookie(request, "development")).toBe(token);
    expect(readSessionCookie(request, "production")).toBe("b".repeat(43));
  });

  it("clears the environment-specific cookie", () => {
    const cookie = expireSessionCookie("production");

    expect(cookie).toContain("__Host-lovechapter_session=");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  });
});
