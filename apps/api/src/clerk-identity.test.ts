import { describe, expect, it, vi } from "vitest";

import {
  authenticateClerkSession,
  createClerkIdentityProvider,
  type ClerkClientLike,
  type ClerkIdentityConfig,
} from "./clerk-identity";

const config: ClerkIdentityConfig = {
  publishableKey: "pk_test_example",
  jwtKey: "test-public-key",
  publicWebOrigin: "https://web.example.test",
};
const request = new Request("https://api.example.test/v1/me", {
  headers: { authorization: "Bearer session-token" },
});

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
    const authenticateRequest = vi.fn(async () => ({
      toAuth: () => ({
        userId: "user_123",
        sessionClaims: { primaryEmail: "couple@example.test" },
      }),
    }));
    const client: ClerkClientLike = { authenticateRequest };

    await expect(
      authenticateClerkSession(request, config, client),
    ).resolves.toEqual({
      subject: "user_123",
      primaryEmail: "couple@example.test",
    });
    expect(authenticateRequest).toHaveBeenCalledWith(request, {
      acceptsToken: "session_token",
      jwtKey: "test-public-key",
      authorizedParties: ["https://web.example.test"],
    });
  });

  it("rejects an authenticated state without the required email claim", async () => {
    const client: ClerkClientLike = {
      authenticateRequest: vi.fn(async () => ({
        toAuth: () => ({ userId: "user_123", sessionClaims: {} }),
      })),
    };

    await expect(
      authenticateClerkSession(request, config, client),
    ).resolves.toBeNull();
  });
});
