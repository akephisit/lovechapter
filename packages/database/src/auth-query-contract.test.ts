import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildClaimEmailJobsQuery,
  buildCleanupQuery,
  buildCreateSessionIfCredentialsCurrentQuery,
  buildFindAccountByEmailKeyQuery,
  buildFailEmailJobQuery,
  buildConsumePasswordResetQuery,
  buildRevokeAccountSessionsQuery,
  buildRehashPasswordIfCurrentQuery,
  buildResolveSessionQuery,
  buildUpdatePasswordQuery,
} from "./auth-queries";

const dialect = new PgDialect();
const accountId = "018f0000-0000-7000-8000-000000000001";
const tokenId = "018f0000-0000-7000-8000-000000000002";
const now = new Date("2026-09-22T00:00:00.000Z");

describe("authentication SQL contracts", () => {
  it("uses explicit indexed account and session lookups", () => {
    const signInSql = sqlOf(
      buildFindAccountByEmailKeyQuery("couple@example.test"),
    );
    const sessionSql = sqlOf(buildResolveSessionQuery("a".repeat(64), now));

    expect(signInSql).toMatch(/where "auth_accounts"\."email_key" = \$1/i);
    expect(sessionSql).toMatch(/"token_hash" = \$1/i);
    expect(sessionSql).toMatch(/interval '24 hours'/i);
    expect(`${signInSql}\n${sessionSql}`).not.toMatch(/select\s+\*/i);
  });

  it("claims a bounded deterministic email batch with skip-locked leases", () => {
    const query = dialect.sqlToQuery(
      buildClaimEmailJobsQuery({ now, limit: 10, leaseSeconds: 60 }),
    );

    expect(query.sql).toMatch(/for update skip locked/i);
    expect(query.sql).toMatch(/"leased_until".*<=/i);
    expect(query.sql).toMatch(/"attempt_count" < 8/i);
    expect(query.sql).toMatch(/order by .*"available_at".*"id"/i);
    expect(query.sql).toMatch(/limit \$\d+/i);
    expect(query.params).toContain(10);
    expect(query.sql).not.toMatch(/select\s+\*/i);
  });

  it("exhausts terminal jobs under their active lease", () => {
    const query = dialect.sqlToQuery(
      buildFailEmailJobQuery({
        id: crypto.randomUUID(),
        leasedUntil: new Date("2026-09-22T00:02:00.000Z"),
        now,
        lastErrorCode: "provider_rejected",
      }),
    );

    expect(query.sql).toMatch(/"attempt_count" = 8/i);
    expect(query.sql).toMatch(/"leased_until" = \$\d+/i);
    expect(query.sql).toMatch(/"last_error_code" = \$\d+/i);
  });

  it("uses bounded deterministic retention windows for every cleanup", () => {
    for (const table of [
      "rate_limits",
      "tokens",
      "sessions",
      "email_jobs",
    ] as const) {
      const query = dialect.sqlToQuery(
        buildCleanupQuery(table, { now, limit: 500 }),
      );
      expect(query.sql).toMatch(/order by/i);
      expect(query.sql).toMatch(/"id"/i);
      expect(query.sql).toMatch(/limit \$\d+/i);
      expect(query.params).toContain(500);
    }

    const tokenQuery = dialect.sqlToQuery(
      buildCleanupQuery("tokens", { now, limit: 500 }),
    );
    const sessionQuery = dialect.sqlToQuery(
      buildCleanupQuery("sessions", { now, limit: 500 }),
    );
    const emailJobQuery = dialect.sqlToQuery(
      buildCleanupQuery("email_jobs", { now, limit: 500 }),
    );
    expect(tokenQuery.params).toContainEqual(
      new Date("2026-09-15T00:00:00.000Z"),
    );
    expect(sessionQuery.params).toContainEqual(
      new Date("2026-08-23T00:00:00.000Z"),
    );
    expect(emailJobQuery.params).toContainEqual(
      new Date("2026-09-15T00:00:00.000Z"),
    );
  });

  it("guards session insertion against reset/sign-in races", () => {
    const guardedInsertSql = sqlOf(
      buildCreateSessionIfCredentialsCurrentQuery({
        id: crypto.randomUUID(),
        accountId,
        tokenHash: "b".repeat(64),
        expectedCredentialVersion: 3,
        expectedPasswordHash: "scrypt-envelope",
        idleExpiresAt: new Date("2026-09-29T00:00:00.000Z"),
        absoluteExpiresAt: new Date("2026-10-22T00:00:00.000Z"),
        now,
      }),
    );

    expect(guardedInsertSql).toMatch(/insert into "auth_sessions"/i);
    expect(guardedInsertSql).toMatch(/"credential_version" = \$\d+/i);
    expect(guardedInsertSql).toMatch(/"password_hash" = \$\d+/i);
    expect(guardedInsertSql).toMatch(/"email_verified_at" is not null/i);
    expect(guardedInsertSql).toMatch(/for update/i);
  });

  it("guards password rehash against a newer credential version", () => {
    const rehashSql = sqlOf(
      buildRehashPasswordIfCurrentQuery({
        accountId,
        expectedCredentialVersion: 3,
        expectedPasswordHash: "old-scrypt-envelope",
        passwordHash: "new-scrypt-envelope",
        now,
      }),
    );

    expect(rehashSql).toMatch(/"credential_version" = \$\d+/i);
    expect(rehashSql).toMatch(/"password_hash" = \$\d+/i);
    expect(rehashSql).toMatch(/returning .*"id"/i);
  });

  it("consumes a reset and revokes sessions atomically without broad selects", () => {
    const resetInput = {
      tokenId,
      accountId,
      tokenHash: "c".repeat(64),
      passwordHash: "new-scrypt-envelope",
      now,
    };
    const resetSql = [
      sqlOf(buildConsumePasswordResetQuery(resetInput)),
      sqlOf(buildUpdatePasswordQuery(accountId, resetInput.passwordHash, now)),
      sqlOf(buildRevokeAccountSessionsQuery(accountId, now)),
    ].join("\n");

    expect(resetSql).toMatch(/update "auth_tokens"/i);
    expect(resetSql).toMatch(/update "auth_sessions"[\s\S]*"revoked_at"/i);
    expect(resetSql).toMatch(
      /"credential_version" = .*"credential_version" \+ 1/i,
    );
    expect(resetSql).not.toMatch(/select\s+\*/i);
  });
});

function sqlOf(query: Parameters<PgDialect["sqlToQuery"]>[0]): string {
  return dialect.sqlToQuery(query).sql;
}
