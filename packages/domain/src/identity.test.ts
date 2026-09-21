import { describe, expect, it } from "vitest";

import { createConfiguredIdentityProvider } from "./configured-identity";

describe("configured identity", () => {
  it("fails closed when production authentication is disabled", async () => {
    const provider = createConfiguredIdentityProvider({
      AUTH_MODE: "disabled",
    });
    const request = new Request("https://api.example.test", {
      headers: {
        "x-user-id": crypto.randomUUID(),
        "x-user-role": "owner",
      },
    });

    await expect(provider.resolve(request)).resolves.toBeNull();
  });

  it("uses only server configuration for development identity", async () => {
    const provider = createConfiguredIdentityProvider({
      AUTH_MODE: "development",
      DEV_AUTH_SUBJECT: "configured-subject",
      DEV_AUTH_DISPLAY_NAME: "Configured Couple",
      DEV_AUTH_EMAIL: "configured@example.test",
    });
    const request = new Request("https://api.example.test", {
      headers: { "x-user-id": "spoofed-subject" },
    });

    await expect(provider.resolve(request)).resolves.toEqual({
      provider: "development",
      subject: "configured-subject",
      displayName: "Configured Couple",
      email: "configured@example.test",
    });
  });

  it("fails closed when development identity is incomplete", async () => {
    const provider = createConfiguredIdentityProvider({
      AUTH_MODE: "development",
      DEV_AUTH_DISPLAY_NAME: "Missing subject",
    });

    await expect(provider.resolve()).resolves.toBeNull();
  });
});
