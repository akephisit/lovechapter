import { describe, expect, it } from "vitest";

import { parseApiRuntimeConfig } from "./runtime-config";

const validEnvironment = {
  NODE_ENV: "production",
  AUTH_MODE: "local",
  DATABASE_URL: "postgres://lovechapter:secret@db.example.test/lovechapter",
  PUBLIC_WEB_ORIGIN: "https://web.example.test",
  WEB_PROXY_SHARED_SECRET: Buffer.alloc(32, 1).toString("base64url"),
  RATE_LIMIT_HMAC_KEY: Buffer.alloc(32, 2).toString("base64url"),
  AUTH_TOKEN_ACTIVE_KEY_VERSION: "2",
  AUTH_TOKEN_HMAC_KEYS: JSON.stringify({
    1: Buffer.alloc(32, 3).toString("base64url"),
    2: Buffer.alloc(32, 4).toString("base64url"),
  }),
};

describe("API runtime configuration", () => {
  it("applies the bounded Bun/VPS defaults", () => {
    const config = parseApiRuntimeConfig(validEnvironment);
    expect(config).toMatchObject({
      bunVersion: "1.4.2",
      nodeEnvironment: "production",
      host: "127.0.0.1",
      port: 3001,
      databasePoolMax: 6,
      authMode: "local",
      proxyCredential: validEnvironment.WEB_PROXY_SHARED_SECRET,
      authTokenActiveKeyVersion: 2,
    });
    expect(config.rateLimitHmacKey).toEqual(new Uint8Array(32).fill(2));
    expect(config.authTokenHmacKeys).toEqual(
      new Map([
        [1, new Uint8Array(32).fill(3)],
        [2, new Uint8Array(32).fill(4)],
      ]),
    );
  });

  it("forbids development authentication in production", () => {
    expect(() =>
      parseApiRuntimeConfig({
        ...validEnvironment,
        AUTH_MODE: "development",
      }),
    ).toThrow("AUTH_MODE=development is forbidden in production");
  });

  it.each([
    ["API_PORT", "0"],
    ["API_PORT", "65536"],
    ["DATABASE_POOL_MAX", "0"],
    ["DATABASE_POOL_MAX", "7"],
  ])("rejects an unsafe %s value", (name, value) => {
    expect(() =>
      parseApiRuntimeConfig({ ...validEnvironment, [name]: value }),
    ).toThrow(name);
  });

  it.each([
    ["WEB_PROXY_SHARED_SECRET", Buffer.alloc(31).toString("base64url")],
    ["RATE_LIMIT_HMAC_KEY", "not-base64url!"],
    ["AUTH_TOKEN_ACTIVE_KEY_VERSION", "0"],
    ["AUTH_TOKEN_HMAC_KEYS", "not-json"],
    [
      "AUTH_TOKEN_HMAC_KEYS",
      JSON.stringify({ 1: Buffer.alloc(31).toString("base64url") }),
    ],
  ])("rejects an invalid %s secret configuration", (name, value) => {
    expect(() =>
      parseApiRuntimeConfig({ ...validEnvironment, [name]: value }),
    ).toThrow(name);
  });

  it("requires the active action-token key to be retained", () => {
    expect(() =>
      parseApiRuntimeConfig({
        ...validEnvironment,
        AUTH_TOKEN_ACTIVE_KEY_VERSION: "3",
      }),
    ).toThrow("AUTH_TOKEN_ACTIVE_KEY_VERSION");
  });
});
