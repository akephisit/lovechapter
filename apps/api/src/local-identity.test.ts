import type { Principal } from "@lovechapter/domain";
import { describe, expect, it, vi } from "vitest";

import { createLocalIdentityProvider } from "./local-identity";

const token = "a".repeat(43);

describe("local session identity", () => {
  it("resolves only the configured session cookie through AuthService", async () => {
    const principal: Principal = {
      provider: "local",
      subject: crypto.randomUUID(),
      displayName: "couple@example.test",
      email: "couple@example.test",
    };
    const resolveSession = vi.fn(async () => principal);
    const identity = createLocalIdentityProvider(
      { resolveSession },
      "production",
    );
    const request = new Request("https://api.example.test/v1/me", {
      headers: {
        authorization: `Bearer ${"b".repeat(43)}`,
        cookie: `lovechapter_dev_session=${"c".repeat(43)}; __Host-lovechapter_session=${token}`,
      },
    });

    await expect(identity.resolve(request)).resolves.toEqual(principal);
    expect(resolveSession).toHaveBeenCalledWith(token);
  });

  it("fails closed when the configured cookie is absent", async () => {
    const resolveSession = vi.fn(async () => null);
    const identity = createLocalIdentityProvider(
      { resolveSession },
      "production",
    );

    await expect(
      identity.resolve(
        new Request("https://api.example.test/v1/me", {
          headers: { cookie: `lovechapter_dev_session=${token}` },
        }),
      ),
    ).resolves.toBeNull();
    expect(resolveSession).not.toHaveBeenCalled();
  });
});
