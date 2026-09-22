import { describe, expect, it } from "vitest";

import { normalizeEmail } from "./email";

describe("normalizeEmail", () => {
  it("trims, normalizes to NFC, and lowercases only the lookup key", () => {
    expect(normalizeEmail("  Usér+RSVP@Example.COM  ")).toEqual({
      email: "Usér+RSVP@Example.COM",
      emailKey: "usér+rsvp@example.com",
    });
    expect(normalizeEmail("e\u0301@example.com")).toEqual({
      email: "é@example.com",
      emailKey: "é@example.com",
    });
  });

  it.each([
    "missing-at.example.com",
    "two@@example.com",
    "@example.com",
    "couple@",
    "couple @example.com",
    "couple@example",
  ])("rejects invalid server syntax: %s", (email) => {
    expect(() => normalizeEmail(email)).toThrow("valid email address");
  });

  it("rejects more than 320 Unicode code points", () => {
    expect(() => normalizeEmail(`${"a".repeat(309)}@example.com`)).toThrow(
      "320 Unicode code points",
    );
  });
});
