import { describe, expect, it } from "vitest";

import { createActionTokenCodec, hashSessionToken } from "./tokens";
import type { ActionTokenClaims } from "./types";

const claims: ActionTokenClaims = {
  id: "00000000-0000-4000-8000-000000000001",
  accountId: "00000000-0000-4000-8000-000000000002",
  purpose: "verify_email",
  signingKeyVersion: 2,
  expiresAtEpochSeconds: 1_800_000_000,
};

describe("session token hashing", () => {
  it("stores a fixed-length SHA-256 hash instead of the session secret", () => {
    const sessionToken = "raw-session-secret";
    const hash = hashSessionToken(sessionToken);

    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(sessionToken);
  });
});

describe("action tokens", () => {
  it("round-trips signed metadata and rejects complete-token tampering", () => {
    const codec = createActionTokenCodec({
      activeVersion: 2,
      keys: new Map([[2, key(2)]]),
    });
    const token = codec.create(claims);

    expect(codec.activeVersion).toBe(2);
    expect(token).toMatch(
      /^lc1\.2\.00000000-0000-4000-8000-000000000001\.1800000000\.[A-Za-z0-9_-]{43}$/,
    );
    expect(codec.verify(token, claims)).toBe(true);
    const replacement = token.endsWith("A") ? "B" : "A";
    expect(codec.verify(`${token.slice(0, -1)}${replacement}`, claims)).toBe(
      false,
    );
    expect(codec.hash(token)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("verifies retained older signing-key versions", () => {
    const oldClaims = { ...claims, signingKeyVersion: 1 };
    const oldToken = createActionTokenCodec({
      activeVersion: 1,
      keys: new Map([[1, key(1)]]),
    }).create(oldClaims);
    const codecWithOldAndNewKeys = createActionTokenCodec({
      activeVersion: 2,
      keys: new Map([
        [1, key(1)],
        [2, key(2)],
      ]),
    });

    expect(codecWithOldAndNewKeys.verify(oldToken, oldClaims)).toBe(true);
  });

  it("fails closed for malformed tokens or mismatched stored claims", () => {
    const codec = createActionTokenCodec({
      activeVersion: 2,
      keys: new Map([[2, key(2)]]),
    });
    const token = codec.create(claims);

    expect(codec.parse("not-a-token")).toBeNull();
    expect(codec.verify(token, { ...claims, purpose: "reset_password" })).toBe(
      false,
    );
    expect(
      codec.verify(token, { ...claims, accountId: crypto.randomUUID() }),
    ).toBe(false);
  });
});

function key(version: number): Uint8Array {
  return new Uint8Array(32).fill(version);
}
