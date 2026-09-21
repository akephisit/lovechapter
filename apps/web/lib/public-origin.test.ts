import { describe, expect, it } from "vitest";

import { parsePublicApiOrigin } from "./public-origin";

describe("parsePublicApiOrigin", () => {
  it("accepts an exact HTTP(S) origin and normalizes its trailing slash", () => {
    expect(parsePublicApiOrigin("https://api.example.workers.dev/")).toBe(
      "https://api.example.workers.dev",
    );
    expect(parsePublicApiOrigin("http://localhost:8787")).toBe(
      "http://localhost:8787",
    );
  });

  it.each([undefined, "", "api.example.test", "ftp://api.example.test"])(
    "rejects missing or unsupported origin %s",
    (value) => {
      expect(() => parsePublicApiOrigin(value)).toThrow(
        /NEXT_PUBLIC_API_ORIGIN/,
      );
    },
  );

  it.each([
    "https://user@example.test",
    "https://api.example.test/v1",
    "https://api.example.test?tenant=one",
    "https://api.example.test#fragment",
  ])("rejects a value that is not an origin: %s", (value) => {
    expect(() => parsePublicApiOrigin(value)).toThrow(/exact origin/);
  });
});
