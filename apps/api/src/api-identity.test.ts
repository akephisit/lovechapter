import type { Principal } from "@lovechapter/domain";
import { describe, expect, it, vi } from "vitest";

import { createApiIdentityProvider } from "./api-identity";

describe("API identity configuration", () => {
  it("uses local cookie identity only when local mode is explicit", async () => {
    const token = "a".repeat(43);
    const principal: Principal = {
      provider: "local",
      subject: crypto.randomUUID(),
      displayName: "couple@example.test",
      email: "couple@example.test",
    };
    const resolveSession = vi.fn(async () => principal);
    const provider = createApiIdentityProvider(
      { AUTH_MODE: "local" },
      { authService: { resolveSession }, nodeEnvironment: "production" },
    );

    await expect(
      provider.resolve(
        new Request("https://api.example.test/v1/me", {
          headers: { cookie: `__Host-lovechapter_session=${token}` },
        }),
      ),
    ).resolves.toEqual(principal);
    expect(resolveSession).toHaveBeenCalledWith(token);
  });

  it.each([
    { AUTH_MODE: "disabled" },
    { AUTH_MODE: "development", DEV_AUTH_DISPLAY_NAME: "Missing subject" },
    { AUTH_MODE: "unknown" },
    { AUTH_MODE: "local" },
  ])("fails closed for incomplete $AUTH_MODE mode", async (environment) => {
    const provider = createApiIdentityProvider(environment);

    await expect(
      provider.resolve(new Request("https://api.example.test/v1/me")),
    ).resolves.toBeNull();
  });

  it("keeps explicit development identity available outside production", async () => {
    const provider = createApiIdentityProvider({
      AUTH_MODE: "development",
      DEV_AUTH_SUBJECT: "local-developer",
      DEV_AUTH_DISPLAY_NAME: "Local Developer",
    });

    await expect(provider.resolve()).resolves.toMatchObject({
      provider: "development",
      subject: "local-developer",
    });
  });
});
