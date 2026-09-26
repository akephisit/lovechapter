import {
  createActionTokenCodec,
  type ActionTokenIssue,
} from "@lovechapter/auth";
import {
  createPostgresRuntime,
  type PostgresRuntime,
} from "@lovechapter/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { processEmailBatch } from "./processor";
import { createResendEmailSender } from "./resend-email-sender";

const connectionString = process.env.TEST_DATABASE_URL;
if (
  !connectionString ||
  process.env.TEST_DATABASE_CONFIRM !== "lovechapter_test"
) {
  throw new Error(
    "PostgreSQL integration tests require TEST_DATABASE_URL and TEST_DATABASE_CONFIRM=lovechapter_test",
  );
}
if (
  process.env.DATABASE_URL &&
  new URL(connectionString).hostname ===
    new URL(process.env.DATABASE_URL).hostname
) {
  throw new Error("TEST_DATABASE_URL must use a separate database host");
}

const now = new Date("2000-01-01T00:00:00.000Z");
const accountId = crypto.randomUUID();
const jobId = crypto.randomUUID();
const idempotencyKey = `auth-email/${jobId}`;
const email = `retry-${accountId}@example.test`;
const tokenCodec = createActionTokenCodec({
  activeVersion: 1,
  keys: new Map([[1, new Uint8Array(32).fill(7)]]),
});
let runtime: PostgresRuntime;

beforeAll(async () => {
  runtime = createPostgresRuntime({
    databaseUrl: connectionString,
    databasePoolMax: 2,
  });
  const existing = await runtime.pool.query<{ due: boolean }>(
    "select exists(select 1 from auth_email_jobs where sent_at is null and attempt_count < 8 and available_at <= $1 and (leased_until is null or leased_until <= $1)) as due",
    [now],
  );
  if (existing.rows[0]?.due !== false) {
    throw new Error("Disposable test database has older due email jobs");
  }
});

afterAll(async () => {
  if (!runtime) return;
  try {
    await runtime.pool.query("delete from auth_accounts where id = $1", [
      accountId,
    ]);
    await runtime.pool.query("delete from users where id = $1", [accountId]);
  } finally {
    await runtime.close();
  }
});

describe("PostgreSQL email retry", () => {
  it("persists a temporary provider failure and sends once when due using the same idempotency key", async () => {
    await runtime.authRepository.registerPending(
      {
        candidateAccountId: accountId,
        email,
        emailKey: email,
        displayName: "Retry test",
        passwordHash: "test-only-password-hash",
        now,
      },
      (registeredAccountId): ActionTokenIssue => {
        const token = {
          id: crypto.randomUUID(),
          accountId: registeredAccountId,
          purpose: "verify_email" as const,
          signingKeyVersion: 1,
          expiresAtEpochSeconds: Math.floor(now.getTime() / 1000) + 1_800,
        };
        return {
          token: {
            ...token,
            tokenHash: tokenCodec.hash(tokenCodec.create(token)),
          },
          job: {
            id: jobId,
            accountId: registeredAccountId,
            authTokenId: token.id,
            kind: "verify_email",
            idempotencyKey,
            availableAt: now,
          },
        };
      },
    );

    const providerKeys: string[] = [];
    const sender = createResendEmailSender({
      apiKey: "test-only-key",
      fetch: async (_input, init) => {
        providerKeys.push(
          new Headers(init?.headers).get("Idempotency-Key") ?? "",
        );
        if (providerKeys.length === 1) {
          return Response.json(
            { name: "rate_limit_exceeded" },
            { status: 429 },
          );
        }
        return Response.json({ id: "test-message-id" }, { status: 200 });
      },
    });
    const processAt = (time: Date) =>
      processEmailBatch({
        store: runtime.emailJobStore,
        sender,
        tokenCodec,
        publicWebOrigin: "https://web.example.test",
        fromEmail: "auth@example.test",
        clock: { now: () => time },
      });

    await expect(processAt(now)).resolves.toBe(1);
    const failed = await jobState();
    expect(failed).toMatchObject({
      attempt_count: 1,
      sent_at: null,
      leased_until: null,
      last_error_code: "provider_rate_limited",
      idempotency_key: idempotencyKey,
    });
    expect(failed.available_at).toEqual(new Date(now.getTime() + 15_000));

    await expect(processAt(new Date(now.getTime() + 14_000))).resolves.toBe(0);
    expect(providerKeys).toEqual([idempotencyKey]);

    const retryAt = new Date(now.getTime() + 15_000);
    await expect(processAt(retryAt)).resolves.toBe(1);
    const sent = await jobState();
    expect(sent).toMatchObject({
      attempt_count: 2,
      available_at: retryAt,
      leased_until: null,
      sent_at: retryAt,
      last_error_code: null,
      idempotency_key: idempotencyKey,
    });
    await expect(processAt(new Date(now.getTime() + 60_000))).resolves.toBe(0);
    expect(providerKeys).toEqual([idempotencyKey, idempotencyKey]);
  });
});

async function jobState(): Promise<{
  attempt_count: number;
  available_at: Date;
  leased_until: Date | null;
  sent_at: Date | null;
  last_error_code: string | null;
  idempotency_key: string;
}> {
  const result = await runtime.pool.query<{
    attempt_count: number;
    available_at: Date;
    leased_until: Date | null;
    sent_at: Date | null;
    last_error_code: string | null;
    idempotency_key: string;
  }>(
    "select attempt_count, available_at, leased_until, sent_at, last_error_code, idempotency_key from auth_email_jobs where id = $1",
    [jobId],
  );
  const state = result.rows[0];
  if (!state) throw new Error("Email job missing");
  return state;
}
