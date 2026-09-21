import { describe, expect, it } from "vitest";

import {
  createApiIdentityProvider,
  parsePublicWebOrigin,
} from "./api-identity";

const clerkEnvironment = {
  AUTH_MODE: "clerk",
  CLERK_PUBLISHABLE_KEY: "pk_test_example",
  CLERK_JWT_KEY: "test-public-key",
  PUBLIC_WEB_ORIGIN: "https://web.example.test/",
};

describe("API identity configuration", () => {
  it("uses Clerk only when Clerk mode is explicit", async () => {
    const provider = createApiIdentityProvider(clerkEnvironment, async () => ({
      subject: "user_123",
      primaryEmail: "couple@example.test",
    }));

    await expect(
      provider.resolve(new Request("https://api.example.test/v1/me")),
    ).resolves.toMatchObject({ provider: "clerk", subject: "user_123" });
  });

  it.each([
    [
      "CLERK_PUBLISHABLE_KEY",
      { ...clerkEnvironment, CLERK_PUBLISHABLE_KEY: "" },
    ],
    ["CLERK_JWT_KEY", { ...clerkEnvironment, CLERK_JWT_KEY: "" }],
    ["PUBLIC_WEB_ORIGIN", { ...clerkEnvironment, PUBLIC_WEB_ORIGIN: "" }],
  ] as const)("rejects missing %s in Clerk mode", (name, environment) => {
    expect(() => createApiIdentityProvider(environment)).toThrow(name);
  });

  it.each([
    { AUTH_MODE: "disabled" },
    { AUTH_MODE: "development", DEV_AUTH_DISPLAY_NAME: "Missing subject" },
    { AUTH_MODE: "unknown" },
  ])("fails closed for $AUTH_MODE mode", async (environment) => {
    const provider = createApiIdentityProvider(environment);

    await expect(provider.resolve()).resolves.toBeNull();
  });

  it("does not fall back to development when Clerk configuration is invalid", () => {
    expect(() =>
      createApiIdentityProvider({
        AUTH_MODE: "clerk",
        DEV_AUTH_SUBJECT: "unsafe-fallback",
        DEV_AUTH_DISPLAY_NAME: "Unsafe fallback",
      }),
    ).toThrow("PUBLIC_WEB_ORIGIN");
  });
});

describe("PUBLIC_WEB_ORIGIN", () => {
  it("normalizes a root HTTP(S) URL to its exact origin", () => {
    expect(parsePublicWebOrigin(" https://web.example.test/ ")).toBe(
      "https://web.example.test",
    );
    expect(parsePublicWebOrigin("http://localhost:3000")).toBe(
      "http://localhost:3000",
    );
  });

  it.each([
    "ftp://web.example.test",
    "https://user:password@web.example.test",
    "https://web.example.test/path",
    "https://web.example.test?query=yes",
    "https://web.example.test/#fragment",
    "not-a-url",
  ])("rejects a non-origin value: %s", (value) => {
    expect(() => parsePublicWebOrigin(value)).toThrow("PUBLIC_WEB_ORIGIN");
  });
});
