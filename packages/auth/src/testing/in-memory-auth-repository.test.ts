import type { ActionTokenIssue } from "../types";
import { describe, expect, it } from "vitest";

import { InMemoryAuthRepository } from "./in-memory-auth-repository";

const now = new Date("2026-09-22T00:00:00.000Z");

describe("InMemoryAuthRepository", () => {
  it("serializes duplicate pending registration and replaces current work", async () => {
    const repository = new InMemoryAuthRepository();
    const input = {
      candidateAccountId: crypto.randomUUID(),
      email: "Couple@example.test",
      emailKey: "couple@example.test",
      displayName: "คู่รัก",
      passwordHash: "hash-one",
      now,
    };

    await Promise.all([
      repository.registerPending(input, issue("verify_email")),
      repository.registerPending(
        { ...input, candidateAccountId: crypto.randomUUID() },
        issue("verify_email"),
      ),
    ]);

    expect(repository.accountsByEmailKey.size).toBe(1);
    expect(repository.currentJobs("verification")).toHaveLength(1);
  });

  it("allows exactly one conditional token consumer", async () => {
    const repository = new InMemoryAuthRepository();
    await repository.registerPending(
      {
        candidateAccountId: crypto.randomUUID(),
        email: "Couple@example.test",
        emailKey: "couple@example.test",
        displayName: "คู่รัก",
        passwordHash: "hash-one",
        now,
      },
      issue("verify_email"),
    );
    const token = repository.currentToken("verify_email");
    if (!token) throw new Error("Test token missing");
    const input = {
      tokenId: token.id,
      accountId: token.accountId,
      tokenHash: token.tokenHash,
      now,
    };

    const outcomes = await Promise.all([
      repository.consumeEmailVerification(input),
      repository.consumeEmailVerification(input),
    ]);

    expect(outcomes.toSorted()).toEqual([false, true]);
  });
});

function issue(
  purpose: "verify_email" | "reset_password",
): (accountId: string) => ActionTokenIssue {
  return (accountId) => {
    const id = crypto.randomUUID();
    return {
      token: {
        id,
        accountId,
        purpose,
        signingKeyVersion: 1,
        expiresAtEpochSeconds: 1_800_000_000,
        tokenHash: "a".repeat(64),
      },
      job: {
        id: crypto.randomUUID(),
        accountId,
        authTokenId: id,
        kind: purpose,
        idempotencyKey: crypto.randomUUID(),
        availableAt: now,
      },
    };
  };
}
