import { describe, expect, it } from "vitest";

import { AUTH_RATE_LIMITS, rateLimitKey } from "./rate-limits";

describe("authentication rate limits", () => {
  it("derives non-reversible lookup keys for request fingerprints", () => {
    const fingerprint = "203.0.113.7";
    const key = rateLimitKey(new Uint8Array(32).fill(7), fingerprint);

    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain(fingerprint);
    expect(rateLimitKey(new Uint8Array(32).fill(8), fingerprint)).not.toBe(key);
  });

  it("defines the fixed initial PostgreSQL bucket policy", () => {
    expect(AUTH_RATE_LIMITS).toEqual({
      signUpFingerprint: { limit: 5, windowSeconds: 3600 },
      signUpEmail: { limit: 3, windowSeconds: 3600 },
      signInFingerprint: { limit: 20, windowSeconds: 900 },
      signInEmail: { limit: 10, windowSeconds: 900 },
      verificationFingerprint: { limit: 10, windowSeconds: 900 },
      verificationEmail: { limit: 3, windowSeconds: 3600 },
      forgotFingerprint: { limit: 5, windowSeconds: 3600 },
      forgotEmail: { limit: 5, windowSeconds: 3600 },
      resetFingerprint: { limit: 10, windowSeconds: 900 },
    });
  });
});
