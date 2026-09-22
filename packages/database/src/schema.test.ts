import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  authAccounts,
  authEmailJobs,
  authRateLimits,
  authSessions,
  authTokens,
  guests,
  invitations,
  rsvps,
  users,
  weddingMembers,
  weddings,
} from "./schema";

describe("MVP PostgreSQL schema", () => {
  it("defines the business and local-auth tables needed by the vertical slice", () => {
    expect(
      [
        users,
        weddings,
        weddingMembers,
        guests,
        invitations,
        rsvps,
        authAccounts,
        authSessions,
        authTokens,
        authRateLimits,
        authEmailJobs,
      ]
        .map((table) => getTableConfig(table).name)
        .toSorted(),
    ).toEqual([
      "auth_accounts",
      "auth_email_jobs",
      "auth_rate_limits",
      "auth_sessions",
      "auth_tokens",
      "guests",
      "invitations",
      "rsvps",
      "users",
      "wedding_members",
      "weddings",
    ]);
  });

  it("defines the five approved auth tables and access-pattern indexes", () => {
    const authTableNames = [
      authAccounts,
      authEmailJobs,
      authRateLimits,
      authSessions,
      authTokens,
    ]
      .map((table) => getTableConfig(table).name)
      .toSorted();

    expect(authTableNames).toEqual([
      "auth_accounts",
      "auth_email_jobs",
      "auth_rate_limits",
      "auth_sessions",
      "auth_tokens",
    ]);
    expect(indexNames(authAccounts)).toContain(
      "auth_accounts_email_key_unique",
    );
    expect(indexNames(authSessions)).toEqual(
      expect.arrayContaining([
        "auth_sessions_token_hash_unique",
        "auth_sessions_account_active_idx",
        "auth_sessions_active_expiry_idx",
        "auth_sessions_revoked_cleanup_idx",
      ]),
    );
    expect(indexNames(authTokens)).toEqual(
      expect.arrayContaining([
        "auth_tokens_token_hash_unique",
        "auth_tokens_account_purpose_active_idx",
        "auth_tokens_expiry_cleanup_idx",
      ]),
    );
    expect(indexNames(authEmailJobs)).toEqual(
      expect.arrayContaining([
        "auth_email_jobs_idempotency_key_unique",
        "auth_email_jobs_due_idx",
      ]),
    );
    expect(getTableConfig(authRateLimits).primaryKeys).toHaveLength(1);
  });

  it("enforces unique external identities and membership access order", () => {
    const userConfig = getTableConfig(users);
    const userIndexes = userConfig.indexes.map((index) => index.config);
    const memberIndexes = getTableConfig(weddingMembers).indexes.map(
      (index) => index.config,
    );

    expect(userIndexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "users_auth_identity_unique",
          unique: true,
        }),
      ]),
    );
    expect(memberIndexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "wedding_members_user_created_idx",
          unique: false,
        }),
      ]),
    );
    expect(
      userConfig.columns.find(
        (column) => column.name === "onboarding_completed_at",
      )?.notNull,
    ).toBe(false);
    expect(userConfig.indexes.map((index) => index.config.name)).not.toContain(
      "users_onboarding_completed_idx",
    );
  });

  it("enforces guest scope and one active invitation per guest", () => {
    const invitationConfig = getTableConfig(invitations);
    const guestForeignKey = invitationConfig.foreignKeys
      .map((foreignKey) => foreignKey.reference())
      .find((reference) => reference.name === "invitations_guest_scope_fk");
    const activeIndex = invitationConfig.indexes.find(
      (index) => index.config.name === "invitations_one_active_per_guest",
    );

    expect(guestForeignKey?.columns.map((column) => column.name)).toEqual([
      "wedding_id",
      "guest_id",
    ]);
    expect(
      guestForeignKey?.foreignColumns.map((column) => column.name),
    ).toEqual(["wedding_id", "id"]);
    expect(activeIndex?.config.unique).toBe(true);
    expect(activeIndex?.config.where).toBeDefined();
  });

  it("ties each RSVP to an invitation for the same wedding and guest", () => {
    const references = getTableConfig(rsvps).foreignKeys.map((foreignKey) =>
      foreignKey.reference(),
    );
    const invitationReference = references.find(
      (reference) => reference.name === "rsvps_invitation_scope_fk",
    );

    expect(invitationReference?.columns.map((column) => column.name)).toEqual([
      "wedding_id",
      "guest_id",
      "invitation_id",
    ]);
    expect(
      invitationReference?.foreignColumns.map((column) => column.name),
    ).toEqual(["wedding_id", "guest_id", "id"]);
  });
});

function indexNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table)
    .indexes.map((index) => index.config.name)
    .filter((name): name is string => name !== undefined);
}
