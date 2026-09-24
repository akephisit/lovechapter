import { describe, expect, it, vi } from "vitest";
import type { Client } from "pg";

import { createWorkerHandlers } from "./worker";

const key = Buffer.alloc(32, 7).toString("base64url");
const environment = {
  HYPERDRIVE: { connectionString: "postgres://hyperdrive-placeholder" },
  NODE_ENV: "production",
  AUTH_MODE: "disabled",
  PUBLIC_WEB_ORIGIN: "https://lovechapter-web.example.workers.dev",
  WEB_PROXY_SHARED_SECRET: key,
  RATE_LIMIT_HMAC_KEY: key,
  AUTH_TOKEN_ACTIVE_KEY_VERSION: "1",
  AUTH_TOKEN_HMAC_KEYS: JSON.stringify({ 1: key }),
};

describe("Cloudflare API Worker", () => {
  it("serves liveness without connecting to PostgreSQL", async () => {
    const createClient = vi.fn();
    const worker = createWorkerHandlers(createClient);
    const response = await worker.fetch(
      new Request("https://api.example.workers.dev/health/live"),
      environment,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("rejects direct business requests without a proxy credential", async () => {
    const createClient = vi.fn();
    const worker = createWorkerHandlers(createClient);
    const response = await worker.fetch(
      new Request("https://api.example.workers.dev/v1/weddings"),
      environment,
    );
    expect(response.status).toBe(403);
    expect(createClient).not.toHaveBeenCalled();
  });

  it("uses Hyperdrive for readiness and closes the invocation connection", async () => {
    const connect = vi.fn(async () => undefined);
    const end = vi.fn(async () => undefined);
    const createClient = vi.fn(
      () =>
        ({
          connect,
          end,
          query: vi.fn(async () => ({ rows: [{ one: 1 }], rowCount: 1 })),
        }) as unknown as Client,
    );
    const response = await createWorkerHandlers(createClient).fetch(
      new Request("https://api.example.workers.dev/health/ready", {
        headers: { "x-lovechapter-proxy-secret": key },
      }),
      environment,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(createClient).toHaveBeenCalledWith(
      environment.HYPERDRIVE.connectionString,
    );
    expect(connect).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("fails closed when Hyperdrive binding or a required secret is missing", async () => {
    const worker = createWorkerHandlers();
    const request = new Request("https://api.example.workers.dev/health/live");
    await expect(
      worker.fetch(request, { ...environment, HYPERDRIVE: undefined }),
    ).rejects.toThrow("HYPERDRIVE");
    await expect(
      worker.fetch(request, { ...environment, WEB_PROXY_SHARED_SECRET: "" }),
    ).rejects.toThrow("WEB_PROXY_SHARED_SECRET");
  });

  it("refuses local authentication without a configured email sender", async () => {
    const worker = createWorkerHandlers();
    await expect(
      worker.fetch(new Request("https://api.example.workers.dev/health/live"), {
        ...environment,
        AUTH_MODE: "local",
      }),
    ).rejects.toThrow("RESEND_API_KEY");
  });
});
