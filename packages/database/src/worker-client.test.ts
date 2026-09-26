import { describe, expect, it, vi } from "vitest";
import type { Client } from "pg";

import { withPostgresRuntime, withPostgresResponse } from "./client";

describe("withPostgresRuntime", () => {
  it("connects lazily, shares repositories, and closes after readiness", async () => {
    const connect = vi.fn(async () => undefined);
    const end = vi.fn(async () => undefined);
    const query = vi.fn(async () => ({ rows: [{ one: 1 }], rowCount: 1 }));
    const createClient = vi.fn(
      () => ({ connect, end, query }) as unknown as Client,
    );

    await withPostgresRuntime(
      "postgres://hyperdrive-placeholder",
      async (runtime) => {
        expect(runtime.loveChapterRepository).toBeDefined();
        expect(runtime.authRepository).toBeDefined();
        expect(runtime.emailJobStore).toBeDefined();
        expect(createClient).not.toHaveBeenCalled();
        await runtime.readiness();
        expect(connect).toHaveBeenCalledTimes(1);
      },
      createClient,
    );

    expect(createClient).toHaveBeenCalledWith(
      "postgres://hyperdrive-placeholder",
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("closes a connected client when the operation throws", async () => {
    const end = vi.fn(async () => undefined);
    const client = {
      connect: vi.fn(async () => undefined),
      end,
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
    } as unknown as Client;
    await expect(
      withPostgresRuntime(
        "postgres://hyperdrive-placeholder",
        async (runtime) => {
          await runtime.readiness();
          throw new Error("request failed");
        },
        () => client,
      ),
    ).rejects.toThrow("request failed");
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("does not connect for a request with no SQL", async () => {
    const createClient = vi.fn();
    await withPostgresRuntime(
      "postgres://hyperdrive-placeholder",
      async (runtime) => {
        expect(runtime.planningRepository).toBeDefined();
      },
      createClient,
    );
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("withPostgresResponse", () => {
  it("keeps the client available for lazy CSV pages until the stream ends", async () => {
    const end = vi.fn(async () => undefined);
    const createClient = () =>
      ({
        connect: vi.fn(async () => undefined),
        end,
        query: vi.fn(async () => ({ rows: [{ one: 1 }], rowCount: 1 })),
      }) as unknown as Client;
    const response = await withPostgresResponse(
      "postgres://hyperdrive-placeholder",
      async (runtime) =>
        new Response(
          new ReadableStream({
            async pull(controller) {
              await runtime.readiness();
              controller.enqueue(new TextEncoder().encode("guest\r\n"));
              controller.close();
            },
          }),
          { headers: { "content-type": "text/csv" } },
        ),
      createClient,
    );
    expect(await response.text()).toBe("guest\r\n");
    expect(end).toHaveBeenCalledTimes(1);
  });

  it("releases the client after response body cancellation", async () => {
    const end = vi.fn(async () => undefined);
    const response = await withPostgresResponse(
      "postgres://hyperdrive-placeholder",
      async (runtime) => {
        await runtime.readiness();
        return new Response(new ReadableStream({ pull() {} }));
      },
      () =>
        ({
          connect: async () => undefined,
          end,
          query: async () => ({ rows: [{ one: 1 }], rowCount: 1 }),
        }) as unknown as Client,
    );
    await response.body?.cancel();
    expect(end).toHaveBeenCalledTimes(1);
  });
});
