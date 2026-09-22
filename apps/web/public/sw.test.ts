import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

import { describe, expect, it, vi } from "vitest";

type ServiceWorkerListener = (event: {
  waitUntil?(work: Promise<unknown>): void;
}) => void;

describe("service worker isolation", () => {
  it("never intercepts API, invitation, verification, or reset traffic", async () => {
    const listeners = new Map<string, ServiceWorkerListener>();
    const cacheDeletes: string[] = [];
    const source = await readFile(new URL("./sw.js", import.meta.url), "utf8");
    const context = {
      caches: {
        keys: async () => ["lovechapter-old", "unrelated-cache"],
        delete: async (key: string) => {
          cacheDeletes.push(key);
          return true;
        },
      },
      self: {
        addEventListener(type: string, listener: ServiceWorkerListener) {
          listeners.set(type, listener);
        },
        skipWaiting: vi.fn(),
        clients: { claim: vi.fn(async () => undefined) },
      },
    };

    runInNewContext(source, context, { filename: "sw.js" });

    expect(listeners.has("install")).toBe(true);
    expect(listeners.has("activate")).toBe(true);
    for (const requestUrl of [
      "/api/v1/auth/session",
      "/i/private-invitation-token",
      "/verify-email#token=verification-secret",
      "/reset-password#token=reset-secret",
    ]) {
      expect({
        requestUrl,
        interceptedByServiceWorker: listeners.has("fetch"),
      }).toEqual({ requestUrl, interceptedByServiceWorker: false });
    }

    let activation: Promise<unknown> | undefined;
    listeners.get("activate")?.({
      waitUntil(work) {
        activation = work;
      },
    });
    await activation;
    expect(cacheDeletes).toEqual(["lovechapter-old"]);
  });
});
