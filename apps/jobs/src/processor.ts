import type {
  ActionTokenCodec,
  ClaimedEmailJob,
  Clock,
  EmailJobStore,
} from "@lovechapter/auth";

import {
  EmailDeliveryError,
  type EmailMessage,
  type EmailSender,
} from "./resend-email-sender";

export const CLAIM_LIMIT = 10;
export const SEND_CONCURRENCY = 3;
export const LEASE_SECONDS = 120;
export const MAX_ATTEMPTS = 8;
export const MIN_IDLE_DELAY_MS = 250;
export const MAX_IDLE_DELAY_MS = 5_000;
export const CLEANUP_INTERVAL_MS = 15 * 60 * 1_000;
export const CLEANUP_BATCH_SIZE = 500;

type SafeLog = (
  event: string,
  fields?: Readonly<Record<string, string | number>>,
) => void;

export type EmailProcessorOptions = {
  store: EmailJobStore;
  guestImportCleanup?: {
    cleanupExpiredGuestImports(input: {
      now: string;
      limit: 500;
    }): Promise<number>;
  };
  sender: EmailSender;
  tokenCodec: ActionTokenCodec;
  publicWebOrigin: string;
  fromEmail: string;
  clock?: Clock;
  log?: SafeLog;
  signal?: AbortSignal;
};

export async function processEmailBatch(
  options: EmailProcessorOptions,
): Promise<number> {
  if (options.signal?.aborted) return 0;
  const now = (options.clock ?? systemClock).now();
  const jobs = await options.store.claimEmailJobs({
    now,
    limit: CLAIM_LIMIT,
    leaseSeconds: LEASE_SECONDS,
  });
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(SEND_CONCURRENCY, jobs.length) },
    async () => {
      while (!options.signal?.aborted && nextIndex < jobs.length) {
        const job = jobs[nextIndex];
        nextIndex += 1;
        if (job) await processJob(job, options, now);
      }
    },
  );
  await Promise.all(workers);
  return jobs.length;
}

export async function runJobLoop(
  options: EmailProcessorOptions & {
    signal: AbortSignal;
    sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  },
): Promise<void> {
  const clock = options.clock ?? systemClock;
  const sleep = options.sleep ?? abortableDelay;
  let idleDelay = MIN_IDLE_DELAY_MS;
  let lastCleanupAt: number | null = null;

  while (!options.signal.aborted) {
    const now = clock.now();
    if (
      lastCleanupAt === null ||
      now.getTime() - lastCleanupAt >= CLEANUP_INTERVAL_MS
    ) {
      const result = await options.store.cleanupExpired({
        now,
        limit: CLEANUP_BATCH_SIZE,
      });
      lastCleanupAt = now.getTime();
      options.log?.("auth_email_cleanup", {
        removed:
          result.rateLimits +
          result.tokens +
          result.sessions +
          result.emailJobs,
      });
      if (options.signal.aborted) return;
      if (options.guestImportCleanup) {
        const removed =
          await options.guestImportCleanup.cleanupExpiredGuestImports({
            now: now.toISOString(),
            limit: CLEANUP_BATCH_SIZE,
          });
        options.log?.("guest_import_cleanup", { removed });
      }
    }

    if (options.signal.aborted) return;
    const processed = await processEmailBatch(options);
    if (options.signal.aborted) return;
    if (processed > 0) {
      idleDelay = MIN_IDLE_DELAY_MS;
      continue;
    }
    try {
      await sleep(idleDelay, options.signal);
    } catch (error) {
      if (options.signal.aborted) return;
      throw error;
    }
    if (options.signal.aborted) return;
    idleDelay = Math.min(idleDelay * 2, MAX_IDLE_DELAY_MS);
  }
}

async function processJob(
  job: ClaimedEmailJob,
  options: EmailProcessorOptions,
  now: Date,
): Promise<void> {
  const invalidReason = tokenInvalidReason(job, options.tokenCodec, now);
  if (invalidReason) {
    await failJob(job, invalidReason, options, now);
    return;
  }

  const rawToken = options.tokenCodec.reconstruct(job.token);
  try {
    await options.sender.send(
      emailMessage(job, rawToken, options.publicWebOrigin, options.fromEmail),
      job.idempotencyKey,
    );
    await options.store.markEmailJobSent({
      id: job.id,
      leasedUntil: job.leasedUntil,
      now,
    });
    options.log?.("auth_email_sent", { jobId: job.id });
  } catch (error) {
    const deliveryError =
      error instanceof EmailDeliveryError
        ? error
        : new EmailDeliveryError("provider_unavailable", true);
    if (!deliveryError.retryable || job.attemptCount >= MAX_ATTEMPTS) {
      await failJob(job, deliveryError.code, options, now);
      return;
    }
    await options.store.retryEmailJob({
      id: job.id,
      leasedUntil: job.leasedUntil,
      now,
      availableAt: new Date(now.getTime() + retryDelay(job.attemptCount)),
      lastErrorCode: deliveryError.code,
    });
    options.log?.("auth_email_retry_scheduled", {
      jobId: job.id,
      reasonCode: deliveryError.code,
    });
  }
}

function tokenInvalidReason(
  job: ClaimedEmailJob,
  codec: ActionTokenCodec,
  now: Date,
): "token_consumed" | "token_expired" | "token_invalid" | null {
  if (job.token.consumedAt) return "token_consumed";
  if (job.token.expiresAtEpochSeconds * 1_000 <= now.getTime()) {
    return "token_expired";
  }
  try {
    const rawToken = codec.reconstruct(job.token);
    if (
      codec.hash(rawToken) !== job.token.tokenHash ||
      !codec.verify(rawToken, job.token)
    ) {
      return "token_invalid";
    }
  } catch {
    return "token_invalid";
  }
  return null;
}

async function failJob(
  job: ClaimedEmailJob,
  reasonCode: string,
  options: EmailProcessorOptions,
  now: Date,
): Promise<void> {
  await options.store.failEmailJob({
    id: job.id,
    leasedUntil: job.leasedUntil,
    now,
    lastErrorCode: reasonCode,
  });
  options.log?.("auth_email_terminal", { jobId: job.id, reasonCode });
}

function emailMessage(
  job: ClaimedEmailJob,
  rawToken: string,
  publicWebOrigin: string,
  fromEmail: string,
): EmailMessage {
  const verifying = job.kind === "verify_email";
  const path = verifying ? "/verify-email" : "/reset-password";
  const url = new URL(path, publicWebOrigin);
  url.hash = `token=${encodeURIComponent(rawToken)}`;
  const link = url.toString();
  const action = verifying ? "verify your email" : "reset your password";
  return {
    from: fromEmail,
    to: job.email,
    subject: verifying
      ? "Verify your LoveChapter email"
      : "Reset your LoveChapter password",
    text: `Use this link to ${action}: ${link}`,
    html: `<p>Use this link to ${action}:</p><p><a href="${escapeHtml(link)}">${verifying ? "Verify email" : "Reset password"}</a></p>`,
  };
}

function retryDelay(attemptCount: number): number {
  return Math.min(15_000 * 2 ** Math.max(0, attemptCount - 1), 900_000);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timeout = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
    function finish() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timeout);
      reject(new DOMException("Aborted", "AbortError"));
    }
  });
}

const systemClock: Clock = { now: () => new Date() };
