import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  authenticateClerkSession,
  createClerkIdentityProvider,
  type ClerkIdentityConfig,
  type VerifyClerkToken,
} from "./clerk-identity";

const config: ClerkIdentityConfig = {
  publishableKey: "pk_test_example",
  jwtKey: "test-public-key",
  publicWebOrigin: "https://web.example.test",
};
const request = new Request("https://api.example.test/v1/me", {
  headers: { authorization: "Bearer session-token" },
});
const signingKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwtKey = signingKeys.publicKey
  .export({ type: "spki", format: "pem" })
  .toString();

describe("Clerk identity", () => {
  it("maps only a verified subject and primary email", async () => {
    const provider = createClerkIdentityProvider(config, async () => ({
      subject: "user_123",
      primaryEmail: "  Couple@Example.Test  ",
    }));

    await expect(provider.resolve(request)).resolves.toEqual({
      provider: "clerk",
      subject: "user_123",
      displayName: "couple@example.test",
      email: "couple@example.test",
    });
  });

  it.each(["missing", "malformed", "expired", "wrong-party", "missing-email"])(
    "fails closed for %s sessions",
    async () => {
      const provider = createClerkIdentityProvider(config, async () => null);

      await expect(provider.resolve(request)).resolves.toBeNull();
    },
  );

  it("fails closed when the verifier throws", async () => {
    const provider = createClerkIdentityProvider(config, async () => {
      throw new Error("verification detail must not escape");
    });

    await expect(provider.resolve(request)).resolves.toBeNull();
  });

  it("configures networkless session-token verification", async () => {
    const verify = vi.fn<VerifyClerkToken>(async () => ({
      sub: "user_123",
      sid: "sess_123",
      primaryEmail: "couple@example.test",
    }));

    await expect(
      authenticateClerkSession(request, config, verify),
    ).resolves.toEqual({
      subject: "user_123",
      primaryEmail: "couple@example.test",
    });
    expect(verify).toHaveBeenCalledWith("session-token", {
      jwtKey: "test-public-key",
      authorizedParties: ["https://web.example.test"],
    });
  });

  it("verifies a locally signed session with the real networkless SDK path", async () => {
    const token = signSessionToken(signingKeys.privateKey);
    const signedRequest = new Request("https://api.example.test/v1/me", {
      headers: { authorization: `Bearer ${token}` },
    });

    await expect(
      authenticateClerkSession(signedRequest, { ...config, jwtKey }),
    ).resolves.toEqual({
      subject: "user_123",
      primaryEmail: "couple@example.test",
    });
  });

  it.each([
    ["malformed", "not-a-jwt"],
    [
      "expired",
      signSessionToken(signingKeys.privateKey, {
        iat: epochSeconds() - 120,
        nbf: epochSeconds() - 120,
        exp: epochSeconds() - 60,
      }),
    ],
    [
      "wrong party",
      signSessionToken(signingKeys.privateKey, {
        azp: "https://attacker.example.test",
      }),
    ],
    [
      "missing email claim",
      signSessionToken(signingKeys.privateKey, { primaryEmail: undefined }),
    ],
    [
      "missing session claim",
      signSessionToken(signingKeys.privateKey, { sid: undefined }),
    ],
  ])("rejects a real %s token", async (_name, token) => {
    const signedRequest = new Request("https://api.example.test/v1/me", {
      headers: { authorization: `Bearer ${token}` },
    });

    await expect(
      authenticateClerkSession(signedRequest, { ...config, jwtKey }),
    ).resolves.toBeNull();
  });

  it("rejects an authenticated state without the required email claim", async () => {
    const verify = vi.fn<VerifyClerkToken>(async () => ({
      sub: "user_123",
      sid: "sess_123",
    }));

    await expect(
      authenticateClerkSession(request, config, verify),
    ).resolves.toBeNull();
  });
});

function signSessionToken(
  privateKey: KeyObject,
  overrides: Record<string, unknown> = {},
): string {
  const now = epochSeconds();
  const header = encodeJson({ alg: "RS256", typ: "JWT", kid: "test-key" });
  const payload = encodeJson({
    sub: "user_123",
    sid: "sess_123",
    azp: "https://web.example.test",
    primaryEmail: "couple@example.test",
    iat: now,
    nbf: now - 1,
    exp: now + 60,
    ...overrides,
  });
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = signer.sign(privateKey).toString("base64url");
  return `${unsigned}.${signature}`;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function epochSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
