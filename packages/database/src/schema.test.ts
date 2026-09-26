import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import * as operationalSchema from "./schema";
import {
  authAccounts,
  authEmailJobs,
  authRateLimits,
  authSessions,
  authTokens,
  guestAffiliations,
  guestImportBatches,
  guestImportRows,
  envelopePrintTemplates,
  guestPostalAddresses,
  guests,
  invitations,
  rsvps,
  users,
  weddingMembers,
  weddings,
  planningTasks,
} from "./schema";

describe("MVP PostgreSQL schema", () => {
  it("scopes planning tasks to a wedding and indexes paged tasks and open deadlines", () => {
    const config = getTableConfig(planningTasks);
    expect(config.primaryKeys).toHaveLength(1);
    expect(columnNames(planningTasks)).toEqual(
      expect.arrayContaining([
        "wedding_id",
        "title",
        "category",
        "note",
        "due_date",
        "completed_at",
        "created_at",
        "updated_at",
      ]),
    );
    expect(indexNames(planningTasks)).toEqual(
      expect.arrayContaining([
        "planning_tasks_wedding_created_idx",
        "planning_tasks_open_due_idx",
      ]),
    );
  });
  it("defines the business and local-auth tables needed by the vertical slice", () => {
    expect(
      [
        users,
        weddings,
        planningTasks,
        weddingMembers,
        guestAffiliations,
        guests,
        guestPostalAddresses,
        guestImportBatches,
        guestImportRows,
        envelopePrintTemplates,
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
      "envelope_print_templates",
      "guest_affiliations",
      "guest_import_batches",
      "guest_import_rows",
      "guest_postal_addresses",
      "guests",
      "invitations",
      "planning_tasks",
      "rsvps",
      "users",
      "wedding_members",
      "weddings",
    ]);
  });

  it("stages imports per wedding with composite keys and bounded cleanup/preview indexes", () => {
    const batches = getTableConfig(guestImportBatches);
    const rows = getTableConfig(guestImportRows);
    expect(batches.primaryKeys).toHaveLength(1);
    expect(rows.primaryKeys).toHaveLength(1);
    expect(columnNames(guestImportBatches)).toEqual(
      expect.arrayContaining([
        "source_sha256",
        "headers",
        "mapping",
        "affiliation_mappings",
        "status",
        "preview_version",
        "commit_idempotency_key",
        "commit_result",
        "expires_at",
      ]),
    );
    expect(columnNames(guestImportRows)).toEqual(
      expect.arrayContaining([
        "source_values",
        "candidate",
        "errors",
        "warnings",
        "included",
        "row_number",
      ]),
    );
    expect(foreignKeyNames(guestImportRows)).toContain(
      "guest_import_rows_batch_scope_fk",
    );
    expect(indexNames(guestImportBatches)).toContain(
      "guest_import_batches_cleanup_idx",
    );
    expect(indexNames(guestImportRows)).toEqual(
      expect.arrayContaining([
        "guest_import_rows_preview_idx",
        "guest_import_rows_number_unique",
      ]),
    );
  });

  it("constrains wedding-scoped envelope templates to safe physical settings", () => {
    const config = getTableConfig(envelopePrintTemplates);
    expect(config.primaryKeys).toHaveLength(1);
    expect(columnNames(envelopePrintTemplates)).toEqual(
      expect.arrayContaining([
        "width_mm",
        "height_mm",
        "orientation",
        "margin_top_mm",
        "margin_right_mm",
        "margin_bottom_mm",
        "margin_left_mm",
        "alignment",
        "font_family",
        "font_size_pt",
        "line_spacing_percent",
        "show_address",
        "created_at",
        "updated_at",
      ]),
    );
    expect(indexNames(envelopePrintTemplates)).toEqual(
      expect.arrayContaining([
        "envelope_print_templates_name_unique",
        "envelope_print_templates_order_idx",
      ]),
    );
    expect(config.checks.length).toBeGreaterThanOrEqual(4);
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

  it("keeps a guest affiliation optional and scoped to the same wedding", () => {
    const guestConfig = getTableConfig(guests);
    const affiliationColumn = guestConfig.columns.find(
      (column) => column.name === "affiliation_id",
    );
    const affiliationReference = guestConfig.foreignKeys
      .map((foreignKey) => foreignKey.reference())
      .find((reference) => reference.name === "guests_affiliation_scope_fk");

    expect(affiliationColumn?.notNull).toBe(false);
    expect(affiliationReference?.columns.map((column) => column.name)).toEqual([
      "wedding_id",
      "affiliation_id",
    ]);
    expect(
      affiliationReference?.foreignColumns.map((column) => column.name),
    ).toEqual(["wedding_id", "id"]);
    expect(indexNames(guestAffiliations)).toEqual(
      expect.arrayContaining([
        "guest_affiliations_wedding_name_unique",
        "guest_affiliations_wedding_order_idx",
      ]),
    );
  });

  it("stores optional guest details and indexes active and archived lists", () => {
    expect(columnNames(guests)).toEqual(
      expect.arrayContaining([
        "phone",
        "envelope_name",
        "note",
        "archived_at",
        "updated_at",
      ]),
    );
    expect(indexNames(guests)).toEqual(
      expect.arrayContaining([
        "guests_wedding_active_created_idx",
        "guests_wedding_archived_created_idx",
      ]),
    );
    expect(indexNames(guests)).not.toContain("guests_wedding_created_idx");
  });

  it("keeps postal addresses optional and scoped to the same wedding guest", () => {
    const columns = getTableConfig(guestPostalAddresses).columns;

    expect(foreignKeyNames(guestPostalAddresses)).toContain(
      "guest_postal_addresses_guest_scope_fk",
    );
    expect(
      columns.find((column) => column.name === "address_line_1")?.getSQLType(),
    ).toBe("varchar(180)");
    expect(
      columns.find((column) => column.name === "locality")?.getSQLType(),
    ).toBe("varchar(120)");
    expect(
      columns.find((column) => column.name === "postal_code")?.getSQLType(),
    ).toBe("varchar(32)");
    expect(
      columns.find((column) => column.name === "country_code")?.getSQLType(),
    ).toBe("varchar(2)");
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

describe("release gate schema", () => {
  it("defines operational state, deployed versions, and lease metadata", () => {
    const control = Reflect.get(operationalSchema, "releaseControl") as
      Parameters<typeof getTableConfig>[0] | undefined;
    const leases = Reflect.get(operationalSchema, "releaseLeases") as
      Parameters<typeof getTableConfig>[0] | undefined;

    expect(control).toBeDefined();
    expect(leases).toBeDefined();
    if (!control || !leases) return;

    expect(getTableConfig(control).schema).toBe("ops");
    expect(getTableConfig(control).name).toBe("release_control");
    expect(columnNames(control)).toEqual([
      "id",
      "mode",
      "target_sha",
      "web_version_id",
      "web_source_sha",
      "api_version_id",
      "api_source_sha",
      "changed_at",
    ]);
    expect(getTableConfig(leases).schema).toBe("ops");
    expect(getTableConfig(leases).name).toBe("release_leases");
    expect(columnNames(leases)).toEqual(["id", "kind", "started_at"]);
  });

  it("constrains the singleton, mode, target SHA, and lease identity", () => {
    const control = Reflect.get(operationalSchema, "releaseControl") as
      Parameters<typeof getTableConfig>[0] | undefined;
    const leases = Reflect.get(operationalSchema, "releaseLeases") as
      Parameters<typeof getTableConfig>[0] | undefined;
    expect(control).toBeDefined();
    expect(leases).toBeDefined();
    if (!control || !leases) return;

    expect(getTableConfig(control).checks.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        "release_control_singleton_chk",
        "release_control_mode_chk",
        "release_control_target_sha_chk",
        "release_control_versions_chk",
      ]),
    );
    expect(getTableConfig(leases).primaryKeys).toHaveLength(0);
    expect(
      getTableConfig(leases).columns.find((item) => item.name === "id")
        ?.primary,
    ).toBe(true);
  });
});

function indexNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table)
    .indexes.map((index) => index.config.name)
    .filter((name): name is string => name !== undefined);
}

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

function foreignKeyNames(
  table: Parameters<typeof getTableConfig>[0],
): string[] {
  return getTableConfig(table)
    .foreignKeys.map((foreignKey) => foreignKey.reference().name)
    .filter((name): name is string => name !== undefined);
}
