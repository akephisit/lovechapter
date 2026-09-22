import { describe, expect, it } from "vitest";

import { parseApiRuntimeConfig } from "./runtime-config";

const validEnvironment = {
  NODE_ENV: "production",
  AUTH_MODE: "local",
  DATABASE_URL: "postgres://lovechapter:secret@db.example.test/lovechapter",
  PUBLIC_WEB_ORIGIN: "https://web.example.test",
};

describe("API runtime configuration", () => {
  it("applies the bounded Bun/VPS defaults", () => {
    expect(parseApiRuntimeConfig(validEnvironment)).toMatchObject({
      bunVersion: "1.4.2",
      nodeEnvironment: "production",
      host: "127.0.0.1",
      port: 3001,
      databasePoolMax: 6,
      authMode: "local",
    });
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
});
