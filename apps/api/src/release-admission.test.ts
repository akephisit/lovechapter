import type { ReleaseGateStore } from "@lovechapter/database";
import { describe, expect, it, vi } from "vitest";

import { withApiAdmission } from "./release-admission";

const proxyCredential = "release-gate-proxy-secret";
const ingress = {
  proxyCredential,
  fingerprintKey: new Uint8Array(32).fill(3),
};

function request(path: string, secret = proxyCredential): Request {
  return new Request(`https://api.example.test${path}`, {
    headers: { "x-lovechapter-proxy-secret": secret },
  });
}

function gateFixture() {
  const active = new Set<string>();
  let releases = 0;
  let next = 0;
  const gate: ReleaseGateStore = {
    readMode: async () => "open",
    admit: async () => {
      const id = `lease-${++next}`;
      active.add(id);
      return id;
    },
    release: async (id) => {
      if (!active.delete(id)) throw new Error("Unknown lease");
      releases += 1;
    },
  };
  return { gate, active, releaseCount: () => releases };
}

describe("API release admission", () => {
  it("rejects direct ingress before admission", async () => {
    const fixture = gateFixture();
    const admit = vi.spyOn(fixture.gate, "admit");
    const response = await withApiAdmission(
      request("/v1/weddings", "wrong-secret"),
      fixture.gate,
      ingress,
      async () => new Response("served"),
    );
    expect(response.status).toBe(403);
    expect(admit).not.toHaveBeenCalled();
    expect(fixture.active.size).toBe(0);
    expect(fixture.releaseCount()).toBe(0);
  });

  it("holds a streaming lease until cancellation", async () => {
    const fixture = gateFixture();
    const release = vi.spyOn(fixture.gate, "release");
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("first chunk"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await withApiAdmission(
      request(
        "/v1/weddings/00000000-0000-0000-0000-000000000001/guests/export.csv",
      ),
      fixture.gate,
      ingress,
      async () => new Response(stream),
    );
    expect(fixture.active.size).toBe(1);
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) return;
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(
      "first chunk",
    );
    expect(fixture.active.size).toBe(1);
    expect(release).not.toHaveBeenCalled();
    await reader.cancel();
    expect(cancelled).toBe(true);
    expect(fixture.active.size).toBe(0);
    expect(fixture.releaseCount()).toBe(1);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("holds a response lease until the body finishes", async () => {
    const fixture = gateFixture();
    const response = await withApiAdmission(
      request("/v1/weddings"),
      fixture.gate,
      ingress,
      async () => new Response("done"),
    );
    expect(fixture.active.size).toBe(1);
    expect(await response.text()).toBe("done");
    expect(fixture.active.size).toBe(0);
    expect(fixture.releaseCount()).toBe(1);
  });

  it("releases a lease when the response stream fails", async () => {
    const fixture = gateFixture();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("stream failed"));
      },
    });
    const response = await withApiAdmission(
      request("/v1/weddings"),
      fixture.gate,
      ingress,
      async () => new Response(stream),
    );
    await expect(response.text()).rejects.toThrow("stream failed");
    expect(fixture.active.size).toBe(0);
    expect(fixture.releaseCount()).toBe(1);
  });

  it("releases after handler failure", async () => {
    const fixture = gateFixture();
    await expect(
      withApiAdmission(
        request("/v1/weddings"),
        fixture.gate,
        ingress,
        async () => {
          throw new Error("handler failed");
        },
      ),
    ).rejects.toThrow("handler failed");
    expect(fixture.active.size).toBe(0);
    expect(fixture.releaseCount()).toBe(1);
  });

  it("releases a bodyless response before returning", async () => {
    const fixture = gateFixture();
    const response = await withApiAdmission(
      request("/v1/weddings"),
      fixture.gate,
      ingress,
      async () => new Response(null, { status: 204 }),
    );
    expect(response.status).toBe(204);
    expect(fixture.active.size).toBe(0);
    expect(fixture.releaseCount()).toBe(1);
  });

  it("does not retry failed lease cleanup", async () => {
    const fixture = gateFixture();
    let attempts = 0;
    fixture.gate.release = async () => {
      attempts += 1;
      throw new Error("lease cleanup failed");
    };
    await expect(
      withApiAdmission(
        request("/v1/weddings"),
        fixture.gate,
        ingress,
        async () => new Response(null, { status: 204 }),
      ),
    ).rejects.toThrow("lease cleanup failed");
    expect(attempts).toBe(1);
  });

  it("does not admit work while closed or unreadable", async () => {
    const fixture = gateFixture();
    fixture.gate.admit = async () => null;
    const closed = await withApiAdmission(
      request("/v1/weddings"),
      fixture.gate,
      ingress,
      async () => new Response("should not serve"),
    );
    expect(closed.status).toBe(503);
    expect(closed.headers.get("cache-control")).toBe("no-store");
    expect(closed.headers.get("retry-after")).toBe("60");
    fixture.gate.admit = async () => {
      throw new Error("database failed");
    };
    const unreadable = await withApiAdmission(
      request("/v1/weddings"),
      fixture.gate,
      ingress,
      async () => new Response("should not serve"),
    );
    expect(unreadable.status).toBe(503);
    expect(await unreadable.json()).toEqual({
      error: {
        code: "maintenance",
        message: "Service temporarily unavailable",
      },
    });
  });
});
