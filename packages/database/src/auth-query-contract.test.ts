import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildClaimEmailJobsQuery,
  buildCreateSessionIfCredentialsCurrentQuery,
  buildFindAccountByEmailKeyQuery,
  buildConsumePasswordResetQuery,
  buildRevokeAccountSessionsQuery,
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
    expect(query.sql).toMatch(/order by .*"available_at".*"id"/i);
    expect(query.sql).toMatch(/limit \$\d+/i);
    expect(query.params).toContain(10);
    expect(query.sql).not.toMatch(/select\s+\*/i);
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
