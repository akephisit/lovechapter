import type {
  ActionTokenIssue,
  AuthTokenPurpose,
  PendingRegistration,
} from "@lovechapter/auth";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createPostgresRuntime, type PostgresRuntime } from "./client";

const connectionString = process.env.TEST_DATABASE_URL;
if (
  !connectionString ||
  process.env.TEST_DATABASE_CONFIRM !== "lovechapter_test"
) {
  throw new Error(
    "PostgreSQL integration tests require TEST_DATABASE_URL and TEST_DATABASE_CONFIRM=lovechapter_test",
  );
}
if (connectionString === process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must not reuse DATABASE_URL");
}

let runtime: PostgresRuntime;

beforeAll(async () => {
  const migrationPool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle({ client: migrationPool }), {
      migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
    });
  } finally {
    await migrationPool.end();
  }
  runtime = createPostgresRuntime({
    databaseUrl: connectionString,
    databasePoolMax: 6,
  });
});

beforeEach(async () => {
  await runtime.pool.query(
    "truncate auth_email_jobs, auth_rate_limits, auth_sessions, auth_tokens, auth_accounts, users cascade",
  );
});

afterAll(async () => {
  await runtime?.close();
});

describe("PostgreSQL auth concurrency", () => {
  it("keeps one pending account and one current verification job", async () => {
    const emailKey = "race@example.test";
    await Promise.all([
      runtime.authRepository.registerPending(
        registration(emailKey),
        issue("verify_email"),
      ),
      runtime.authRepository.registerPending(
        registration(emailKey),
        issue("verify_email"),
      ),
    ]);

    const counts = await runtime.pool.query<{
      accounts: string;
      active_tokens: string;
      due_jobs: string;
    }>(
      `select
      (select count(*) from auth_accounts where email_key = $1) as accounts,
      (select count(*) from auth_tokens where purpose = 'verify_email' and consumed_at is null) as active_tokens,
      (select count(*) from auth_email_jobs where sent_at is null) as due_jobs`,
      [emailKey],
    );

    expect(counts.rows[0]).toEqual({
      accounts: "1",
      active_tokens: "1",
      due_jobs: "1",
    });
  });

  it("allows exactly one concurrent token consumer", async () => {
    await runtime.authRepository.registerPending(
      registration("consume@example.test"),
      issue("verify_email"),
    );
    const token = await currentToken("verify_email");
    const input = {
      tokenId: token.id,
      accountId: token.account_id,
      tokenHash: token.token_hash,
      now: new Date(),
    };

    const outcomes = await Promise.all([
      runtime.authRepository.consumeEmailVerification(input),
      runtime.authRepository.consumeEmailVerification(input),
    ]);

    expect(outcomes.toSorted()).toEqual([false, true]);
  });

  it("resolves and refreshes an old verified session", async () => {
    const emailKey = "session-refresh@example.test";
    await runtime.authRepository.registerPending(
      registration(emailKey),
      issue("verify_email"),
    );
    const verification = await currentToken("verify_email");
    await runtime.authRepository.consumeEmailVerification({
      tokenId: verification.id,
      accountId: verification.account_id,
      tokenHash: verification.token_hash,
      now: new Date(),
    });
    const account =
      await runtime.authRepository.findAccountByEmailKey(emailKey);
    if (!account) throw new Error("Integration account missing");

    const now = new Date();
    const sessionHash = "d".repeat(64);
    const oldLastSeen = new Date(now.getTime() - 25 * 3_600_000);
    const created =
      await runtime.authRepository.createSessionIfCredentialsCurrent({
        id: crypto.randomUUID(),
        accountId: account.id,
        tokenHash: sessionHash,
        expectedCredentialVersion: account.credentialVersion,
        expectedPasswordHash: account.passwordHash,
        idleExpiresAt: new Date(now.getTime() + 86_400_000),
        absoluteExpiresAt: new Date(now.getTime() + 30 * 86_400_000),
        now: oldLastSeen,
      });
    expect(created).toBe(true);

    await expect(
      runtime.authRepository.resolveSession(sessionHash, now),
    ).resolves.toEqual({ accountId: account.id, email: emailKey });
    const session = await runtime.pool.query<{
      last_seen_at: Date;
      idle_expires_at: Date;
    }>(
      "select last_seen_at, idle_expires_at from auth_sessions where token_hash = $1",
      [sessionHash],
    );
    expect(session.rows[0]?.last_seen_at).toEqual(now);
    expect(session.rows[0]?.idle_expires_at).toEqual(
      new Date(now.getTime() + 7 * 86_400_000),
    );
    await expect(
      runtime.authRepository.resolveSession(sessionHash, now),
    ).resolves.toEqual({ accountId: account.id, email: emailKey });
  });

  it("gives concurrent claimers disjoint email jobs", async () => {
    await runtime.authRepository.registerPending(
      registration("claim-one@example.test"),
      issue("verify_email"),
    );
    await runtime.authRepository.registerPending(
      registration("claim-two@example.test"),
      issue("verify_email"),
    );
    const claim = { now: new Date(), limit: 1, leaseSeconds: 60 };

    const [first, second] = await Promise.all([
      runtime.emailJobStore.claimEmailJobs(claim),
      runtime.emailJobStore.claimEmailJobs(claim),
    ]);

    const ids = [...first, ...second].map((job) => job.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it("leaves no valid stale session when reset races sign-in", async () => {
    await runtime.authRepository.registerPending(
      registration("reset-race@example.test"),
      issue("verify_email"),
    );
    const verification = await currentToken("verify_email");
    await runtime.authRepository.consumeEmailVerification({
      tokenId: verification.id,
      accountId: verification.account_id,
      tokenHash: verification.token_hash,
      now: new Date(),
    });
    const account = await runtime.authRepository.findAccountByEmailKey(
      "reset-race@example.test",
    );
    if (!account) throw new Error("Integration account missing");
    const reset = issue("reset_password")(account.id);
    await runtime.authRepository.queuePasswordReset({
      ...reset,
      emailKey: account.emailKey,
      now: new Date(),
    });
    const sessionHash = "f".repeat(64);
    const resetInput = {
      tokenId: reset.token.id,
      accountId: account.id,
      tokenHash: reset.token.tokenHash,
      passwordHash: "new-scrypt-envelope",
      now: new Date(),
    };
    const sessionInput = {
      id: crypto.randomUUID(),
      accountId: account.id,
      tokenHash: sessionHash,
      expectedCredentialVersion: account.credentialVersion,
      expectedPasswordHash: account.passwordHash,
      idleExpiresAt: new Date(Date.now() + 7 * 86_400_000),
      absoluteExpiresAt: new Date(Date.now() + 30 * 86_400_000),
      now: new Date(),
    };

    await Promise.all([
      runtime.authRepository.resetPasswordAndRevokeSessions(resetInput),
      runtime.authRepository.createSessionIfCredentialsCurrent(sessionInput),
    ]);

    const active = await runtime.pool.query(
      "select id from auth_sessions where token_hash = $1 and revoked_at is null",
      [sessionHash],
    );
    expect(active.rows).toHaveLength(0);
  });
});

async function currentToken(purpose: AuthTokenPurpose): Promise<{
  id: string;
  account_id: string;
  token_hash: string;
}> {
  const result = await runtime.pool.query<{
    id: string;
    account_id: string;
    token_hash: string;
  }>(
    "select id, account_id, token_hash from auth_tokens where purpose = $1 and consumed_at is null order by created_at desc, id desc limit 1",
    [purpose],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`No active ${purpose} token`);
  return row;
}

function registration(emailKey: string): PendingRegistration {
  return {
    candidateAccountId: crypto.randomUUID(),
    email: emailKey,
    emailKey,
    displayName: "คู่รัก",
    passwordHash: "old-scrypt-envelope",
    now: new Date(),
  };
}

function issue(
  purpose: AuthTokenPurpose,
): (accountId: string) => ActionTokenIssue {
  return (accountId) => {
    const tokenId = crypto.randomUUID();
    return {
      token: {
        id: tokenId,
        accountId,
        purpose,
        signingKeyVersion: 1,
        expiresAtEpochSeconds:
          Math.floor(Date.now() / 1000) +
          (purpose === "verify_email" ? 1_800 : 900),
        tokenHash: randomHash(),
      },
      job: {
        id: crypto.randomUUID(),
        accountId,
        authTokenId: tokenId,
        kind: purpose,
        idempotencyKey: crypto.randomUUID(),
        availableAt: new Date(),
      },
    };
  };
}

function randomHash(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
