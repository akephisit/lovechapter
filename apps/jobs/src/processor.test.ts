import {
  createActionTokenCodec,
  type ActionTokenCodec,
  type AuthCleanupRequest,
  type AuthCleanupResult,
  type ClaimedEmailJob,
  type EmailJobClaim,
  type EmailJobCompletion,
  type EmailJobFailure,
  type EmailJobRetry,
  type EmailJobStore,
} from "@lovechapter/auth";
import { describe, expect, it, vi } from "vitest";

import { EmailDeliveryError, type EmailSender } from "./resend-email-sender";
import { processEmailBatch, runJobLoop } from "./processor";

const now = new Date("2026-09-22T12:00:00.000Z");

describe("durable email processor", () => {
  it("cleans expired guest imports on maintenance cadence without logging row values", async () => {
    const store = new FakeJobStore([]);
    const controller = new AbortController();
    const cleanup = vi.fn(async () => 3);
    const log = vi.fn();
    let calls = 0;
    await runJobLoop({
      ...processorOptions(store, { send: vi.fn() }, tokenCodec()),
      guestImportCleanup: { cleanupExpiredGuestImports: cleanup },
      log,
      signal: controller.signal,
      sleep: async () => {
        calls++;
        if (calls === 2) controller.abort();
      },
    });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledWith({
      now: now.toISOString(),
      limit: 500,
    });
    expect(log).toHaveBeenCalledWith("guest_import_cleanup", { removed: 3 });
  });
  it("sends no more than three jobs concurrently", async () => {
    const codec = tokenCodec();
    const store = new FakeJobStore(jobs(codec, 10));
    let active = 0;
    let maxObservedConcurrency = 0;
    const sender: EmailSender = {
      async send() {
        active += 1;
        maxObservedConcurrency = Math.max(maxObservedConcurrency, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return { providerMessageId: crypto.randomUUID() };
      },
    };

    await expect(
      processEmailBatch(processorOptions(store, sender, codec)),
    ).resolves.toBe(10);
    expect(maxObservedConcurrency).toBeLessThanOrEqual(3);
    expect(store.sentJobs).toHaveLength(10);
  });

  it("retries a provider timeout without logging the email or action token", async () => {
    const codec = tokenCodec();
    const [job] = jobs(codec, 1);
    if (!job) throw new Error("Missing test job");
    const actionToken = codec.reconstruct(job.token);
    const store = new FakeJobStore([job]);
    const capturedLogs: string[] = [];
    const sender: EmailSender = {
      async send() {
        throw new EmailDeliveryError("provider_timeout", true);
      },
    };

    await processEmailBatch({
      ...processorOptions(store, sender, codec),
      log: (event, fields) =>
        capturedLogs.push(JSON.stringify({ event, fields })),
    });

    expect(store.retriedJobs[0]).toMatchObject({
      lastErrorCode: "provider_timeout",
      availableAt: new Date(now.getTime() + 15_000),
    });
    expect(capturedLogs.join(" ")).not.toContain(job.email);
    expect(capturedLogs.join(" ")).not.toContain(actionToken);
  });

  it("terminally rejects consumed, expired, and hash-mismatched tokens", async () => {
    const codec = tokenCodec();
    const candidates = jobs(codec, 3);
    const consumed = candidates[0];
    const expired = candidates[1];
    const mismatched = candidates[2];
    if (!consumed || !expired || !mismatched) {
      throw new Error("Missing test jobs");
    }
    consumed.token.consumedAt = new Date(now.getTime() - 1_000);
    expired.token.expiresAtEpochSeconds = Math.floor(now.getTime() / 1000) - 1;
    mismatched.token.tokenHash = "0".repeat(64);
    const store = new FakeJobStore(candidates);
    const sender = { send: vi.fn<EmailSender["send"]>() };

    await processEmailBatch(processorOptions(store, sender, codec));

    expect(sender.send).not.toHaveBeenCalled();
    expect(store.failedJobs.map((failure) => failure.lastErrorCode)).toEqual([
      "token_consumed",
      "token_expired",
      "token_invalid",
    ]);
  });

  it("marks a terminal provider rejection exhausted immediately", async () => {
    const codec = tokenCodec();
    const store = new FakeJobStore(jobs(codec, 1));
    const sender: EmailSender = {
      async send() {
        throw new EmailDeliveryError("provider_rejected", false);
      },
    };

    await processEmailBatch(processorOptions(store, sender, codec));

    expect(store.failedJobs).toEqual([
      expect.objectContaining({ lastErrorCode: "provider_rejected" }),
    ]);
    expect(store.retriedJobs).toHaveLength(0);
  });

  it("uses the durable job idempotency key for provider delivery", async () => {
    const codec = tokenCodec();
    const [job] = jobs(codec, 1);
    if (!job) throw new Error("Missing test job");
    job.idempotencyKey = "persisted-idempotency-key";
    const store = new FakeJobStore([job]);
    const sender = {
      send: vi.fn(async () => ({ providerMessageId: "email_123" })),
    } satisfies EmailSender;

    await processEmailBatch(processorOptions(store, sender, codec));

    expect(sender.send).toHaveBeenCalledWith(
      expect.any(Object),
      "persisted-idempotency-key",
    );
  });

  it("stops dequeuing claimed jobs after shutdown and drains in-flight sends", async () => {
    const codec = tokenCodec();
    const store = new FakeJobStore(jobs(codec, 10));
    const controller = new AbortController();
    const releases: Array<() => void> = [];
    const sender: EmailSender = {
      async send() {
        await new Promise<void>((resolve) => releases.push(resolve));
        return { providerMessageId: crypto.randomUUID() };
      },
    };

    const processing = processEmailBatch({
      ...processorOptions(store, sender, codec),
      signal: controller.signal,
    });
    await waitUntil(() => releases.length === 3);
    controller.abort();
    for (const release of releases) release();
    await processing;

    expect(store.sentJobs).toHaveLength(3);
  });

  it("backs off only on empty queues and exits when aborted", async () => {
    const codec = tokenCodec();
    const store = new FakeJobStore([]);
    const controller = new AbortController();
    const delays: number[] = [];

    await runJobLoop({
      ...processorOptions(store, { send: vi.fn() }, codec),
      signal: controller.signal,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
        if (delays.length === 3) controller.abort();
      },
    });

    expect(delays).toEqual([250, 500, 1_000]);
    expect(store.cleanupRequests).toEqual([{ now, limit: 500 }]);
  });

  it("resets empty-queue backoff after productive work", async () => {
    const codec = tokenCodec();
    const store = new FakeJobStore(jobs(codec, 1));
    const controller = new AbortController();
    const delays: number[] = [];

    await runJobLoop({
      ...processorOptions(
        store,
        {
          async send() {
            return { providerMessageId: "email_123" };
          },
        },
        codec,
      ),
      signal: controller.signal,
      sleep: async (milliseconds) => {
        delays.push(milliseconds);
        controller.abort();
      },
    });

    expect(store.sentJobs).toHaveLength(1);
    expect(delays).toEqual([250]);
  });
});

class FakeJobStore implements EmailJobStore {
  readonly sentJobs: EmailJobCompletion[] = [];
  readonly retriedJobs: EmailJobRetry[] = [];
  readonly failedJobs: EmailJobFailure[] = [];
  readonly cleanupRequests: AuthCleanupRequest[] = [];

  constructor(private pending: ClaimedEmailJob[]) {}

  async claimEmailJobs(input: EmailJobClaim): Promise<ClaimedEmailJob[]> {
    return this.pending.splice(0, input.limit);
  }

  async markEmailJobSent(input: EmailJobCompletion): Promise<void> {
    this.sentJobs.push(input);
  }

  async retryEmailJob(input: EmailJobRetry): Promise<void> {
    this.retriedJobs.push(input);
  }

  async failEmailJob(input: EmailJobFailure): Promise<void> {
    this.failedJobs.push(input);
  }

  async cleanupExpired(input: AuthCleanupRequest): Promise<AuthCleanupResult> {
    this.cleanupRequests.push(input);
    return { rateLimits: 0, tokens: 0, sessions: 0, emailJobs: 0 };
  }
}

function processorOptions(
  store: EmailJobStore,
  sender: EmailSender,
  codec: ActionTokenCodec,
) {
  return {
    store,
    sender,
    tokenCodec: codec,
    publicWebOrigin: "https://web.example.test",
    fromEmail: "auth@example.test",
    clock: { now: () => now },
  };
}

function tokenCodec(): ActionTokenCodec {
  return createActionTokenCodec({
    activeVersion: 2,
    keys: new Map([
      [1, new Uint8Array(32).fill(1)],
      [2, new Uint8Array(32).fill(2)],
    ]),
  });
}

function jobs(codec: ActionTokenCodec, count: number): ClaimedEmailJob[] {
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index + 1).padStart(12, "0");
    const id = `018f0000-0000-4000-8000-${suffix}`;
    const token = {
      id: `028f0000-0000-4000-8000-${suffix}`,
      accountId: `038f0000-0000-4000-8000-${suffix}`,
      purpose: "verify_email" as const,
      signingKeyVersion: 1,
      expiresAtEpochSeconds: Math.floor(now.getTime() / 1000) + 1_800,
      tokenHash: "",
      consumedAt: null,
    };
    token.tokenHash = codec.hash(codec.reconstruct(token));
    return {
      id,
      kind: "verify_email" as const,
      email: `couple-${index}@example.test`,
      idempotencyKey: `auth-email/${id}`,
      attemptCount: 1,
      leasedUntil: new Date(now.getTime() + 120_000),
      token,
    };
  });
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Timed out waiting for test condition");
}
