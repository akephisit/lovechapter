import { describe, expect, it, vi } from "vitest";
import type { EmailJobStore } from "@lovechapter/auth";
import type { ReleaseGateStore } from "@lovechapter/database";
import { runScheduledBatch } from "./worker-jobs";

function gate(admitted = true): ReleaseGateStore {
  return {
    readMode: async () => (admitted ? "open" : "maintenance"),
    admit: vi.fn(async () => (admitted ? "lease-1" : null)),
    release: vi.fn(async () => undefined),
  };
}

describe("Cloudflare scheduled jobs", () => {
  it("claims a bounded email batch on the minute trigger", async () => {
    const claimEmailJobs = vi.fn(async () => []);
    const cleanupExpired = vi.fn(async () => ({
      rateLimits: 0,
      tokens: 0,
      sessions: 0,
      emailJobs: 0,
    }));
    const guestCleanup = vi.fn(async () => 0);
    await runScheduledBatch(
      "* * * * *",
      {
        store: { claimEmailJobs, cleanupExpired } as unknown as EmailJobStore,
        guestImportCleanup: { cleanupExpiredGuestImports: guestCleanup },
        sender: { send: vi.fn() },
        tokenCodec: {} as never,
        publicWebOrigin: "https://web.example",
        fromEmail: "hello@example.com",
      },
      gate(),
    );
    expect(claimEmailJobs).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, leaseSeconds: 120 }),
    );
    expect(cleanupExpired).not.toHaveBeenCalled();
    expect(guestCleanup).not.toHaveBeenCalled();
  });

  it("only runs bounded retention cleanup on the quarter-hour trigger", async () => {
    const claimEmailJobs = vi.fn();
    const cleanupExpired = vi.fn(async () => ({
      rateLimits: 1,
      tokens: 2,
      sessions: 3,
      emailJobs: 4,
    }));
    const guestCleanup = vi.fn(async () => 4);
    await runScheduledBatch(
      "*/15 * * * *",
      {
        store: { claimEmailJobs, cleanupExpired } as unknown as EmailJobStore,
        guestImportCleanup: { cleanupExpiredGuestImports: guestCleanup },
        sender: { send: vi.fn() },
        tokenCodec: {} as never,
        publicWebOrigin: "https://web.example",
        fromEmail: "hello@example.com",
      },
      gate(),
    );
    expect(cleanupExpired).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 500 }),
    );
    expect(guestCleanup).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 500 }),
    );
    expect(claimEmailJobs).not.toHaveBeenCalled();
  });

  it("rejects an unknown trigger without claiming jobs", async () => {
    const claimEmailJobs = vi.fn();
    await expect(
      runScheduledBatch(
        "0 0 * * *",
        {
          store: { claimEmailJobs } as unknown as EmailJobStore,
          sender: { send: vi.fn() },
          tokenCodec: {} as never,
          publicWebOrigin: "https://web.example",
          fromEmail: "hello@example.com",
        },
        gate(),
      ),
    ).rejects.toThrow("Unsupported cron");
    expect(claimEmailJobs).not.toHaveBeenCalled();
  });

  it("does no scheduled work while closed", async () => {
    const releaseGate = gate(false);
    const claimEmailJobs = vi.fn(async () => []);
    const cleanupExpired = vi.fn(async () => ({
      rateLimits: 0,
      tokens: 0,
      sessions: 0,
      emailJobs: 0,
    }));
    const guestCleanup = vi.fn(async () => 0);
    const options = {
      store: { claimEmailJobs, cleanupExpired } as unknown as EmailJobStore,
      guestImportCleanup: { cleanupExpiredGuestImports: guestCleanup },
      sender: { send: vi.fn() },
      tokenCodec: {} as never,
      publicWebOrigin: "https://web.example",
      fromEmail: "hello@example.com",
    };
    await runScheduledBatch("* * * * *", options, releaseGate);
    await runScheduledBatch("*/15 * * * *", options, releaseGate);
    expect(claimEmailJobs).not.toHaveBeenCalled();
    expect(cleanupExpired).not.toHaveBeenCalled();
    expect(guestCleanup).not.toHaveBeenCalled();
    expect(releaseGate.release).not.toHaveBeenCalled();
  });

  it("releases after scheduled failure", async () => {
    const releaseGate = gate();
    const cleanupExpired = vi.fn(async () => {
      throw new Error("cleanup failed");
    });
    await expect(
      runScheduledBatch(
        "*/15 * * * *",
        {
          store: { cleanupExpired } as unknown as EmailJobStore,
          sender: { send: vi.fn() },
          tokenCodec: {} as never,
          publicWebOrigin: "https://web.example",
          fromEmail: "hello@example.com",
        },
        releaseGate,
      ),
    ).rejects.toThrow("cleanup failed");
    expect(releaseGate.release).toHaveBeenCalledTimes(1);
  });
});
