import { describe, expect, it } from "vitest";

import { parseJobsRuntimeConfig } from "./runtime-config";

const validEnvironment = {
  DATABASE_URL: "postgres://lovechapter:secret@db.example.test/lovechapter",
  DATABASE_POOL_MAX: "2",
  PUBLIC_WEB_ORIGIN: "https://web.example.test",
  AUTH_TOKEN_ACTIVE_KEY_VERSION: "2",
  AUTH_TOKEN_HMAC_KEYS: JSON.stringify({
    1: Buffer.alloc(32, 1).toString("base64url"),
    2: Buffer.alloc(32, 2).toString("base64url"),
  }),
  RESEND_API_KEY: "re_test_abcdefghijklmnopqrstuvwxyz",
  RESEND_FROM_EMAIL: "auth@example.test",
};

describe("jobs runtime configuration", () => {
  it("parses a bounded database pool and retained signing keys", () => {
    const config = parseJobsRuntimeConfig(validEnvironment);

    expect(config).toMatchObject({
      databasePoolMax: 2,
      publicWebOrigin: "https://web.example.test",
      authTokenActiveKeyVersion: 2,
      resendApiKey: validEnvironment.RESEND_API_KEY,
      resendFromEmail: "auth@example.test",
    });
    expect(config.authTokenHmacKeys).toEqual(
      new Map([
        [1, new Uint8Array(32).fill(1)],
        [2, new Uint8Array(32).fill(2)],
      ]),
    );
  });

  it.each([
    ["DATABASE_POOL_MAX", "3"],
    ["PUBLIC_WEB_ORIGIN", "https://web.example.test/path"],
    ["AUTH_TOKEN_ACTIVE_KEY_VERSION", "0"],
    ["AUTH_TOKEN_HMAC_KEYS", "{}"],
    ["AUTH_TOKEN_HMAC_KEYS", JSON.stringify({ 1: "too-short" })],
    ["RESEND_API_KEY", ""],
    ["RESEND_FROM_EMAIL", "not-an-email"],
  ])("rejects invalid %s configuration", (name, value) => {
    expect(() =>
      parseJobsRuntimeConfig({ ...validEnvironment, [name]: value }),
    ).toThrow(name);
  });

  it("requires the active signing key to be present", () => {
    expect(() =>
      parseJobsRuntimeConfig({
        ...validEnvironment,
        AUTH_TOKEN_ACTIVE_KEY_VERSION: "3",
      }),
    ).toThrow("AUTH_TOKEN_ACTIVE_KEY_VERSION");
  });
});
