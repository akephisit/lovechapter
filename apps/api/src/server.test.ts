import { afterEach, describe, expect, it, vi } from "vitest";

import { createGracefulHttpLifecycle, startApiServer } from "./server";

describe("Bun API server", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("starts Bun with bounded HTTP settings", () => {
    const server = { stop: vi.fn(async () => undefined) };
    const serve = vi.fn(() => server);
    vi.stubGlobal("Bun", { serve });
    const fetch = () => new Response("ok");

    const started = startApiServer({
      fetch,
      hostname: "127.0.0.1",
      port: 3001,
    });

    expect(started).toBe(server);
    expect(serve).toHaveBeenCalledWith({
      hostname: "127.0.0.1",
      port: 3001,
      idleTimeout: 30,
      maxRequestBodySize: 1_048_576,
      fetch,
    });
  });

  it("rejects new traffic while draining and closes resources", async () => {
    let releaseClose!: () => void;
    const close = vi.fn(
      () => new Promise<void>((resolve) => (releaseClose = resolve)),
    );
    const lifecycle = createGracefulHttpLifecycle({
      fetch: () => new Response("ok"),
      close,
    });
    const server = {
      stop: vi.fn(async () => undefined),
    } as unknown as Bun.Server<undefined>;

    const shutdown = lifecycle.shutdown(server);
    const draining = await lifecycle.fetch(
      new Request("https://api.example.test/v1/me"),
    );

    expect(draining.status).toBe(503);
    expect(draining.headers.get("connection")).toBe("close");
    expect(server.stop).toHaveBeenCalledWith(false);
    expect(close).toHaveBeenCalledOnce();

    releaseClose();
    await shutdown;
  });

  it("forces termination only after the shutdown deadline", async () => {
    vi.useFakeTimers();
    const forceExit = vi.fn();
    const lifecycle = createGracefulHttpLifecycle({
      fetch: () => new Response("ok"),
      close: () => new Promise(() => undefined),
      forceExit,
      shutdownDeadlineMs: 30_000,
    });
    const server = {
      stop: vi.fn(async () => undefined),
    } as unknown as Bun.Server<undefined>;

    void lifecycle.shutdown(server);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(forceExit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(forceExit).toHaveBeenCalledWith(1);
  });
});
