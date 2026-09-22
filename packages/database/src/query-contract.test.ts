import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildCreateGuestAffiliationQuery,
  buildCreateGuestQuery,
  buildDeleteGuestAffiliationQuery,
  buildListGuestAffiliationsQuery,
  buildListGuestsQuery,
  buildListWeddingsQuery,
  buildPublicInvitationQuery,
  buildLockGuestAffiliationScopeQuery,
  buildReorderGuestAffiliationsQuery,
  buildSetGuestAffiliationQuery,
  buildSyncUserQuery,
  buildUpdateGuestAffiliationQuery,
  buildUpdateUserProfileQuery,
  buildUpsertRsvpQuery,
  buildUnassignGuestAffiliationQuery,
} from "./queries";

const dialect = new PgDialect();
const userId = "018f0000-0000-7000-8000-000000000001";
const weddingId = "018f0000-0000-7000-8000-000000000002";
const guestId = "018f0000-0000-7000-8000-000000000003";
const affiliationId = "018f0000-0000-7000-8000-000000000004";

describe("PostgreSQL query contracts", () => {
  it("preserves a local profile during identity sync", () => {
    const query = dialect.sqlToQuery(
      buildSyncUserQuery({
        id: userId,
        provider: "external",
        subject: "external-user",
        displayName: "couple@example.test",
        email: "couple@example.test",
      }),
    );

    expect(query.sql).toMatch(/do update set\s+"email" = excluded\."email"/i);
    expect(query.sql).not.toMatch(/do update set[\s\S]*"display_name" =/i);
  });

  it("updates onboarding by the resolved local primary key", () => {
    const query = dialect.sqlToQuery(
      buildUpdateUserProfileQuery({ userId, displayName: "คู่รัก" }),
    );

    expect(query.sql).toMatch(/where "users"\."id" = \$\d+/i);
    expect(query.sql).toMatch(/"onboarding_completed_at" = now\(\)/i);
    expect(query.params).toEqual(expect.arrayContaining([userId, "คู่รัก"]));
  });

  it("lists weddings using the indexed membership keyset", () => {
    const query = dialect.sqlToQuery(
      buildListWeddingsQuery({
        userId,
        limit: 20,
        cursor: {
          createdAt: "2026-09-21T10:00:00.000Z",
          id: weddingId,
        },
      }),
    );

    expect(query.sql).toMatch(
      /\("wedding_members"\."created_at", "wedding_members"\."wedding_id"\) < \(\$\d+, \$\d+\)/i,
    );
    expect(query.sql).toMatch(
      /order by "wedding_members"\."created_at" desc, "wedding_members"\."wedding_id" desc/i,
    );
    expect(query.sql).toMatch(/as "cursor_created_at"/i);
    expect(query.params).toContain(21);
  });

  it("lists guests in one bounded tenant-scoped query with an RSVP join", () => {
    const query = dialect.sqlToQuery(
      buildListGuestsQuery({
        userId,
        weddingId,
        limit: 20,
        cursor: {
          createdAt: "2026-09-21T10:00:00.000Z",
          id: guestId,
        },
      }),
    );

    expect(query.sql).toMatch(/from "wedding_members"/i);
    expect(query.sql).toMatch(/left join "rsvps"/i);
    expect(query.sql).toMatch(/left join "guest_affiliations"/i);
    expect(query.sql).toMatch(/"wedding_members"\."wedding_id" = \$\d+/i);
    expect(query.sql).toMatch(/order by .*"created_at" desc.*"id" desc/i);
    expect(query.sql).toMatch(/limit \$\d+/i);
    expect(query.sql).not.toMatch(/select\s+\*/i);
    expect(query.params).toContain(21);
  });

  it("creates a guest only through an authorized membership selection", () => {
    const query = dialect.sqlToQuery(
      buildCreateGuestQuery({
        id: guestId,
        userId,
        weddingId,
        name: "Nok",
        email: null,
        allowedPartySize: 2,
        affiliationId,
      }),
    );

    expect(query.sql).toMatch(/insert into "guests"/i);
    expect(query.sql).toMatch(/select[\s\S]*from "wedding_members"/i);
    expect(query.sql).toMatch(/"wedding_members"\."user_id" = \$\d+/i);
    expect(query.sql).toMatch(/from "guest_affiliations"/i);
    expect(query.sql).toMatch(/"guest_affiliations"\."wedding_id" = \$\d+/i);
    expect(query.sql).toMatch(/returning[\s\S]*"id"/i);
    expect(query.params).toEqual(
      expect.arrayContaining([guestId, userId, weddingId, "Nok", 2]),
    );
  });

  it("manages affiliations through tenant-scoped bounded statements", () => {
    const list = dialect.sqlToQuery(
      buildListGuestAffiliationsQuery({ userId, weddingId }),
    );
    const create = dialect.sqlToQuery(
      buildCreateGuestAffiliationQuery({
        id: affiliationId,
        userId,
        weddingId,
        name: "Family",
        color: "#a855f7",
      }),
    );
    const update = dialect.sqlToQuery(
      buildUpdateGuestAffiliationQuery({
        userId,
        weddingId,
        affiliationId,
        name: "Close family",
        color: "#db2777",
      }),
    );
    const reorder = dialect.sqlToQuery(
      buildReorderGuestAffiliationsQuery({
        userId,
        weddingId,
        affiliationIds: [affiliationId],
      }),
    );
    const lock = dialect.sqlToQuery(
      buildLockGuestAffiliationScopeQuery({ userId, weddingId }),
    );
    const affiliationLock = dialect.sqlToQuery(
      buildLockGuestAffiliationScopeQuery({
        userId,
        weddingId,
        affiliationId,
      }),
    );
    const unassign = dialect.sqlToQuery(
      buildUnassignGuestAffiliationQuery({
        userId,
        weddingId,
        affiliationId,
      }),
    );
    const remove = dialect.sqlToQuery(
      buildDeleteGuestAffiliationQuery({
        userId,
        weddingId,
        affiliationId,
      }),
    );

    for (const query of [
      list,
      create,
      update,
      reorder,
      lock,
      affiliationLock,
      unassign,
      remove,
    ]) {
      expect(query.sql).toMatch(/"wedding_members"/i);
      expect(query.params).toContain(userId);
      expect(query.params).toContain(weddingId);
      expect(query.sql).not.toMatch(/select\s+\*/i);
    }
    expect(list.sql).toMatch(/limit 101/i);
    expect(create.sql).toMatch(/having count\(.+\) < 100/i);
    expect(lock.sql).toMatch(/for update of "weddings"/i);
    expect(affiliationLock.sql).toMatch(
      /for update of "weddings", "guest_affiliations"/i,
    );
    expect(reorder.sql).toMatch(/unnest\(\(\$\d+\)::uuid\[\]\)/i);
    expect(unassign.sql).toMatch(/update "guests"/i);
    expect(unassign.sql).toMatch(/"affiliation_id" = null/i);
    expect(remove.sql).toMatch(/^delete from "guest_affiliations"/i);
  });

  it("assigns an existing guest only through same-wedding membership", () => {
    const query = dialect.sqlToQuery(
      buildSetGuestAffiliationQuery({
        userId,
        weddingId,
        guestId,
        affiliationId,
      }),
    );

    expect(query.sql).toMatch(/update "guests"/i);
    expect(query.sql).toMatch(/from "wedding_members"/i);
    expect(query.sql).toMatch(/from "guest_affiliations"/i);
    expect(query.sql).toMatch(/"guest_affiliations"\."wedding_id" = \$\d+/i);
    expect(query.params).toEqual(
      expect.arrayContaining([userId, weddingId, guestId, affiliationId]),
    );
  });

  it("resolves a public invitation by hash without selecting the hash", () => {
    const tokenHash = "a".repeat(64);
    const query = dialect.sqlToQuery(buildPublicInvitationQuery(tokenHash));

    expect(query.sql).toMatch(/where "invitations"\."token_hash" = \$1/i);
    expect(query.sql).toMatch(/"invitations"\."revoked_at" is null/i);
    expect(query.sql).not.toMatch(/^select .*token_hash/is);
    expect(query.params).toEqual([tokenHash]);
  });

  it("upserts RSVP scope from the invitation token in one statement", () => {
    const tokenHash = "b".repeat(64);
    const query = dialect.sqlToQuery(
      buildUpsertRsvpQuery({
        id: crypto.randomUUID(),
        tokenHash,
        attendance: "attending",
        partySize: 2,
        note: "Vegetarian",
      }),
    );

    expect(query.sql).toMatch(/^with "valid_invitation" as/i);
    expect(query.sql.match(/insert into "rsvps"/gi)).toHaveLength(1);
    expect(query.sql).toMatch(/on conflict \("wedding_id","guest_id"\)/i);
    expect(query.sql).toMatch(/invalid_party_size/i);
    expect(query.sql).not.toContain(tokenHash);
    expect(query.params).toContain(tokenHash);
    expect(query.sql.trim().endsWith(";")).toBe(false);
  });
});
