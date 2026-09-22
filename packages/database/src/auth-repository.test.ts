import type {
  ActionTokenIssue,
  IssueActionToken,
  PendingRegistration,
} from "@lovechapter/auth";
import type { SQL } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import {
  PostgresAuthRepository,
  PostgresEmailJobStore,
} from "./auth-repository";
import type { QueryExecutor } from "./repository";

const now = new Date("2026-09-22T00:00:00.000Z");
const actualAccountId = "018f0000-0000-7000-8000-000000000001";

describe("PostgresAuthRepository", () => {
  it("issues verification for the actual account id inside one transaction", async () => {
    const executor = new FakeExecutor(
      [{ id: actualAccountId }],
      [],
      [],
      [],
      [],
    );
    const issueVerification = vi.fn<IssueActionToken>((accountId) =>
      verificationIssue(accountId),
    );
    const repository = new PostgresAuthRepository(executor);

    await expect(
      repository.registerPending(registration(), issueVerification),
    ).resolves.toEqual({ emailQueued: true });

    expect(issueVerification).toHaveBeenCalledWith(actualAccountId);
    expect(executor.transactionCount).toBe(1);
    expect(executor.executeCount).toBe(5);
  });

  it("does not overwrite or disclose an existing verified account", async () => {
    const executor = new FakeExecutor([]);
    const issueVerification = vi.fn<IssueActionToken>();
    const repository = new PostgresAuthRepository(executor);

    await expect(
      repository.registerPending(registration(), issueVerification),
    ).resolves.toEqual({ emailQueued: false });

    expect(issueVerification).not.toHaveBeenCalled();
    expect(executor.executeCount).toBe(1);
  });

  it("returns whether a credential-guarded session insert won", async () => {
    const repository = new PostgresAuthRepository(
      new FakeExecutor([{ id: crypto.randomUUID() }], []),
    );
    const input = {
      id: crypto.randomUUID(),
      accountId: actualAccountId,
      tokenHash: "a".repeat(64),
      expectedCredentialVersion: 1,
      expectedPasswordHash: "scrypt-envelope",
      idleExpiresAt: new Date("2026-09-29T00:00:00.000Z"),
      absoluteExpiresAt: new Date("2026-10-22T00:00:00.000Z"),
      now,
    };

    await expect(
      repository.createSessionIfCredentialsCurrent(input),
    ).resolves.toBe(true);
    await expect(
      repository.createSessionIfCredentialsCurrent(input),
    ).resolves.toBe(false);
  });

  it("maps one joined session result", async () => {
    const repository = new PostgresAuthRepository(
      new FakeExecutor([
        { account_id: actualAccountId, email: "Couple@example.test" },
      ]),
    );

    await expect(
      repository.resolveSession("a".repeat(64), now),
    ).resolves.toEqual({
      accountId: actualAccountId,
      email: "Couple@example.test",
    });
  });

  it("serializes password update and session revocation in one transaction", async () => {
    const executor = new FakeExecutor(
      [{ account_id: actualAccountId }],
      [{ id: actualAccountId }],
      [],
    );
    const repository = new PostgresAuthRepository(executor);

    await expect(
      repository.resetPasswordAndRevokeSessions({
        tokenId: crypto.randomUUID(),
        accountId: actualAccountId,
        tokenHash: "d".repeat(64),
        passwordHash: "new-scrypt-envelope",
        now,
      }),
    ).resolves.toBe(true);

    expect(executor.transactionCount).toBe(1);
    expect(executor.executeCount).toBe(3);
  });
});

describe("PostgresEmailJobStore", () => {
  it("maps claimed token metadata and rejects batches over ten", async () => {
    const jobId = crypto.randomUUID();
    const tokenId = crypto.randomUUID();
    const leasedUntil = new Date("2026-09-22T00:01:00.000Z");
    const store = new PostgresEmailJobStore(
      new FakeExecutor([
        {
          id: jobId,
          kind: "verify_email",
          email: "Couple@example.test",
          idempotency_key: "verify-job-1",
          attempt_count: 1,
          leased_until: leasedUntil,
          token_id: tokenId,
          account_id: actualAccountId,
          purpose: "verify_email",
          token_hash: "b".repeat(64),
          signing_key_version: 2,
          expires_at: new Date("2026-09-22T00:30:00.000Z"),
          consumed_at: null,
        },
      ]),
    );

    await expect(
      store.claimEmailJobs({ now, limit: 10, leaseSeconds: 60 }),
    ).resolves.toEqual([
      expect.objectContaining({
        id: jobId,
        leasedUntil,
        token: expect.objectContaining({
          id: tokenId,
          accountId: actualAccountId,
        }),
      }),
    ]);
    await expect(
      store.claimEmailJobs({ now, limit: 11, leaseSeconds: 60 }),
    ).rejects.toThrow("between 1 and 10");
  });
});

class FakeExecutor implements QueryExecutor {
  private readonly results: unknown[][];
  executeCount = 0;
  transactionCount = 0;

  constructor(...results: unknown[][]) {
    this.results = results;
  }

  async execute<T extends Record<string, unknown>>(
    _query: SQL,
  ): Promise<{ rows: T[] }> {
    this.executeCount += 1;
    return { rows: (this.results.shift() ?? []) as T[] };
  }

  async transaction<T>(
    operation: (executor: QueryExecutor) => Promise<T>,
  ): Promise<T> {
    this.transactionCount += 1;
    return operation(this);
  }
}

function registration(): PendingRegistration {
  return {
    candidateAccountId: crypto.randomUUID(),
    email: "Couple@example.test",
    emailKey: "couple@example.test",
    displayName: "คู่รัก",
    passwordHash: "scrypt-envelope",
    now,
  };
}

function verificationIssue(accountId: string): ActionTokenIssue {
  const tokenId = crypto.randomUUID();
  return {
    token: {
      id: tokenId,
      accountId,
      purpose: "verify_email",
      signingKeyVersion: 2,
      expiresAtEpochSeconds: 1_800_000_000,
      tokenHash: "c".repeat(64),
    },
    job: {
      id: crypto.randomUUID(),
      accountId,
      authTokenId: tokenId,
      kind: "verify_email",
      idempotencyKey: "verify-job-1",
      availableAt: now,
    },
  };
}
