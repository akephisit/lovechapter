import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const membershipRole = pgEnum("membership_role", [
  "owner",
  "couple",
  "planner",
  "collaborator",
]);

export const attendanceStatus = pgEnum("attendance_status", [
  "attending",
  "declined",
]);

export const authTokenPurpose = pgEnum("auth_token_purpose", [
  "verify_email",
  "reset_password",
]);

export const guestImportStatus = pgEnum("guest_import_status", [
  "previewed",
  "committed",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
    .notNull()
    .defaultNow(),
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    authProvider: varchar("auth_provider", { length: 64 }).notNull(),
    authSubject: varchar("auth_subject", { length: 255 }).notNull(),
    displayName: varchar("display_name", { length: 120 }).notNull(),
    email: varchar("email", { length: 320 }),
    onboardingCompletedAt: timestamp("onboarding_completed_at", {
      withTimezone: true,
      mode: "string",
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("users_auth_identity_unique").on(
      table.authProvider,
      table.authSubject,
    ),
  ],
);

export const weddings = pgTable(
  "weddings",
  {
    id: uuid("id").primaryKey(),
    name: varchar("name", { length: 120 }).notNull(),
    weddingDate: date("wedding_date", { mode: "string" }),
    timeZone: varchar("time_zone", { length: 64 }).notNull(),
    locale: varchar("locale", { length: 35 }).notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    workspaceOwnerUserId: uuid("workspace_owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    billingOwnerUserId: uuid("billing_owner_user_id").references(
      () => users.id,
      {
        onDelete: "set null",
      },
    ),
    ...timestamps,
  },
  (table) => [
    index("weddings_owner_idx").on(table.workspaceOwnerUserId),
    index("weddings_creator_idx").on(table.createdByUserId),
    index("weddings_billing_owner_idx").on(table.billingOwnerUserId),
  ],
);

export const weddingMembers = pgTable(
  "wedding_members",
  {
    weddingId: uuid("wedding_id")
      .notNull()
      .references(() => weddings.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "wedding_members_pkey",
      columns: [table.weddingId, table.userId],
    }),
    index("wedding_members_user_created_idx").on(
      table.userId,
      table.createdAt.desc(),
      table.weddingId.desc(),
    ),
  ],
);

export const planningTasks = pgTable(
  "planning_tasks",
  {
    id: uuid("id").notNull(),
    weddingId: uuid("wedding_id")
      .notNull()
      .references(() => weddings.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 180 }).notNull(),
    category: varchar("category", { length: 80 }),
    note: varchar("note", { length: 2_000 }),
    dueDate: date("due_date", { mode: "string" }),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "string",
    }),
    ...timestamps,
  },
  (table) => [
    primaryKey({
      name: "planning_tasks_pkey",
      columns: [table.weddingId, table.id],
    }),
    index("planning_tasks_wedding_created_idx").on(
      table.weddingId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index("planning_tasks_open_due_idx")
      .on(table.weddingId, table.dueDate, table.id)
      .where(
        sql`${table.completedAt} is null and ${table.dueDate} is not null`,
      ),
    check(
      "planning_tasks_title_nonblank",
      sql`length(trim(${table.title})) > 0`,
    ),
  ],
);

export const guestAffiliations = pgTable(
  "guest_affiliations",
  {
    id: uuid("id").notNull(),
    weddingId: uuid("wedding_id")
      .notNull()
      .references(() => weddings.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    color: varchar("color", { length: 7 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    ...timestamps,
  },
  (table) => [
    primaryKey({
      name: "guest_affiliations_pkey",
      columns: [table.weddingId, table.id],
    }),
    uniqueIndex("guest_affiliations_wedding_name_unique").on(
      table.weddingId,
      sql`lower(${table.name})`,
    ),
    index("guest_affiliations_wedding_order_idx").on(
      table.weddingId,
      table.sortOrder,
      table.id,
    ),
    check(
      "guest_affiliations_color_check",
      sql`${table.color} ~ '^#[0-9a-f]{6}$'`,
    ),
    check("guest_affiliations_sort_order_check", sql`${table.sortOrder} >= 0`),
  ],
);

export const guests = pgTable(
  "guests",
  {
    id: uuid("id").notNull(),
    weddingId: uuid("wedding_id")
      .notNull()
      .references(() => weddings.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    email: varchar("email", { length: 320 }),
    phone: varchar("phone", { length: 40 }),
    allowedPartySize: integer("allowed_party_size").notNull().default(1),
    affiliationId: uuid("affiliation_id"),
    envelopeName: varchar("envelope_name", { length: 180 }),
    note: varchar("note", { length: 2_000 }),
    archivedAt: timestamp("archived_at", {
      withTimezone: true,
      mode: "string",
    }),
    ...timestamps,
  },
  (table) => [
    primaryKey({ name: "guests_pkey", columns: [table.weddingId, table.id] }),
    check(
      "guests_allowed_party_size_check",
      sql`${table.allowedPartySize} between 1 and 20`,
    ),
    foreignKey({
      name: "guests_affiliation_scope_fk",
      columns: [table.weddingId, table.affiliationId],
      foreignColumns: [guestAffiliations.weddingId, guestAffiliations.id],
    }).onDelete("restrict"),
    index("guests_wedding_active_created_idx")
      .on(table.weddingId, table.createdAt.desc(), table.id.desc())
      .where(sql`${table.archivedAt} is null`),
    index("guests_wedding_archived_created_idx")
      .on(table.weddingId, table.createdAt.desc(), table.id.desc())
      .where(sql`${table.archivedAt} is not null`),
    index("guests_wedding_affiliation_idx")
      .on(table.weddingId, table.affiliationId)
      .where(sql`${table.affiliationId} is not null`),
  ],
);

export const guestPostalAddresses = pgTable(
  "guest_postal_addresses",
  {
    weddingId: uuid("wedding_id").notNull(),
    guestId: uuid("guest_id").notNull(),
    addressLine1: varchar("address_line_1", { length: 180 }).notNull(),
    addressLine2: varchar("address_line_2", { length: 180 }),
    locality: varchar("locality", { length: 120 }),
    administrativeArea: varchar("administrative_area", { length: 120 }),
    postalCode: varchar("postal_code", { length: 32 }),
    countryCode: varchar("country_code", { length: 2 }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "guest_postal_addresses_pkey",
      columns: [table.weddingId, table.guestId],
    }),
    foreignKey({
      name: "guest_postal_addresses_guest_scope_fk",
      columns: [table.weddingId, table.guestId],
      foreignColumns: [guests.weddingId, guests.id],
    }).onDelete("cascade"),
    check(
      "guest_postal_addresses_country_code_check",
      sql.raw("country_code is null or country_code ~ '^[A-Z]{2}$'"),
    ),
  ],
);

export const envelopePrintTemplates = pgTable(
  "envelope_print_templates",
  {
    id: uuid("id").notNull(),
    weddingId: uuid("wedding_id")
      .notNull()
      .references(() => weddings.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 80 }).notNull(),
    widthMm: integer("width_mm").notNull(),
    heightMm: integer("height_mm").notNull(),
    orientation: varchar("orientation", { length: 9 }).notNull(),
    marginTopMm: integer("margin_top_mm").notNull(),
    marginRightMm: integer("margin_right_mm").notNull(),
    marginBottomMm: integer("margin_bottom_mm").notNull(),
    marginLeftMm: integer("margin_left_mm").notNull(),
    alignment: varchar("alignment", { length: 6 }).notNull(),
    fontFamily: varchar("font_family", { length: 16 }).notNull(),
    fontSizePt: integer("font_size_pt").notNull(),
    lineSpacingPercent: integer("line_spacing_percent").notNull(),
    showAddress: boolean("show_address").notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({
      name: "envelope_print_templates_pkey",
      columns: [table.weddingId, table.id],
    }),
    uniqueIndex("envelope_print_templates_name_unique").on(
      table.weddingId,
      sql`lower(${table.name})`,
    ),
    index("envelope_print_templates_order_idx").on(
      table.weddingId,
      table.updatedAt.desc(),
      table.id.desc(),
    ),
    check(
      "envelope_print_templates_dimensions_check",
      sql`${table.widthMm} between 90 and 330 and ${table.heightMm} between 55 and 480`,
    ),
    check(
      "envelope_print_templates_margins_check",
      sql`${table.marginTopMm} >= 0 and ${table.marginRightMm} >= 0 and ${table.marginBottomMm} >= 0 and ${table.marginLeftMm} >= 0 and ${table.widthMm} - ${table.marginLeftMm} - ${table.marginRightMm} >= 20 and ${table.heightMm} - ${table.marginTopMm} - ${table.marginBottomMm} >= 20`,
    ),
    check(
      "envelope_print_templates_orientation_check",
      sql`${table.orientation} in ('landscape', 'portrait') and ${table.alignment} in ('left', 'center', 'right')`,
    ),
    check(
      "envelope_print_templates_font_check",
      sql`${table.fontFamily} in ('noto-sans-thai', 'noto-serif-thai') and ${table.fontSizePt} between 8 and 72 and ${table.lineSpacingPercent} between 80 and 250`,
    ),
    check(
      "envelope_print_templates_name_check",
      sql`length(trim(${table.name})) between 1 and 80`,
    ),
  ],
);

export const guestImportBatches = pgTable(
  "guest_import_batches",
  {
    id: uuid("id").notNull(),
    weddingId: uuid("wedding_id")
      .notNull()
      .references(() => weddings.id, { onDelete: "cascade" }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    sourceSha256: varchar("source_sha256", { length: 64 }).notNull(),
    headers: jsonb("headers").$type<string[]>().notNull(),
    mapping: jsonb("mapping").$type<Record<string, number | null>>().notNull(),
    affiliationMappings: jsonb("affiliation_mappings")
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    status: guestImportStatus("status").notNull().default("previewed"),
    previewVersion: integer("preview_version").notNull().default(1),
    rowCount: integer("row_count").notNull(),
    validCount: integer("valid_count").notNull(),
    warningCount: integer("warning_count").notNull(),
    invalidCount: integer("invalid_count").notNull(),
    excludedCount: integer("excluded_count").notNull(),
    commitIdempotencyKey: varchar("commit_idempotency_key", { length: 128 }),
    commitResult: jsonb("commit_result").$type<{
      created: number;
      excluded: number;
      guestIds: string[];
    }>(),
    committedAt: timestamp("committed_at", {
      withTimezone: true,
      mode: "string",
    }),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    ...timestamps,
  },
  (table) => [
    primaryKey({
      name: "guest_import_batches_pkey",
      columns: [table.weddingId, table.id],
    }),
    index("guest_import_batches_cleanup_idx").on(
      table.status,
      table.expiresAt,
      table.weddingId,
      table.id,
    ),
    check(
      "guest_import_batches_sha_check",
      sql`${table.sourceSha256} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "guest_import_batches_version_check",
      sql`${table.previewVersion} > 0`,
    ),
    check(
      "guest_import_batches_counts_check",
      sql`${table.rowCount} between 0 and 5000 and ${table.validCount} >= 0 and ${table.warningCount} >= 0 and ${table.invalidCount} >= 0 and ${table.excludedCount} >= 0`,
    ),
  ],
);

export const guestImportRows = pgTable(
  "guest_import_rows",
  {
    id: uuid("id").notNull(),
    weddingId: uuid("wedding_id").notNull(),
    batchId: uuid("batch_id").notNull(),
    rowNumber: integer("row_number").notNull(),
    sourceValues: jsonb("source_values").$type<string[]>().notNull(),
    candidate: jsonb("candidate").$type<Record<string, unknown>>(),
    errors: jsonb("errors").$type<string[]>().notNull().default([]),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    included: boolean("included").notNull().default(true),
  },
  (table) => [
    primaryKey({
      name: "guest_import_rows_pkey",
      columns: [table.weddingId, table.id],
    }),
    foreignKey({
      name: "guest_import_rows_batch_scope_fk",
      columns: [table.weddingId, table.batchId],
      foreignColumns: [guestImportBatches.weddingId, guestImportBatches.id],
    }).onDelete("cascade"),
    uniqueIndex("guest_import_rows_number_unique").on(
      table.weddingId,
      table.batchId,
      table.rowNumber,
    ),
    index("guest_import_rows_preview_idx").on(
      table.weddingId,
      table.batchId,
      table.rowNumber,
      table.id,
    ),
    check("guest_import_rows_number_check", sql`${table.rowNumber} >= 2`),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey(),
    weddingId: uuid("wedding_id").notNull(),
    guestId: uuid("guest_id").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "string" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: "invitations_guest_scope_fk",
      columns: [table.weddingId, table.guestId],
      foreignColumns: [guests.weddingId, guests.id],
    }).onDelete("cascade"),
    uniqueIndex("invitations_token_hash_unique").on(table.tokenHash),
    uniqueIndex("invitations_wedding_guest_id_unique").on(
      table.weddingId,
      table.guestId,
      table.id,
    ),
    uniqueIndex("invitations_one_active_per_guest")
      .on(table.weddingId, table.guestId)
      .where(sql`${table.revokedAt} is null`),
    index("invitations_creator_idx").on(table.createdByUserId),
  ],
);

export const rsvps = pgTable(
  "rsvps",
  {
    id: uuid("id").primaryKey(),
    weddingId: uuid("wedding_id").notNull(),
    guestId: uuid("guest_id").notNull(),
    invitationId: uuid("invitation_id").notNull(),
    attendance: attendanceStatus("attendance").notNull(),
    partySize: integer("party_size").notNull(),
    note: varchar("note", { length: 500 }),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      name: "rsvps_invitation_scope_fk",
      columns: [table.weddingId, table.guestId, table.invitationId],
      foreignColumns: [
        invitations.weddingId,
        invitations.guestId,
        invitations.id,
      ],
    }).onDelete("cascade"),
    uniqueIndex("rsvps_wedding_guest_unique").on(
      table.weddingId,
      table.guestId,
    ),
    index("rsvps_invitation_idx").on(table.invitationId),
    check(
      "rsvps_party_size_check",
      sql`(${table.attendance} = 'attending' and ${table.partySize} between 1 and 20) or (${table.attendance} = 'declined' and ${table.partySize} = 0)`,
    ),
  ],
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: uuid("id").primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    emailKey: varchar("email_key", { length: 320 }).notNull(),
    passwordHash: varchar("password_hash", { length: 255 }).notNull(),
    emailVerifiedAt: timestamp("email_verified_at", {
      withTimezone: true,
      mode: "string",
    }),
    credentialVersion: integer("credential_version").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("auth_accounts_email_key_unique").on(table.emailKey),
    check(
      "auth_accounts_credential_version_check",
      sql`${table.credentialVersion} > 0`,
    ),
  ],
);

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => authAccounts.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    idleExpiresAt: timestamp("idle_expires_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    absoluteExpiresAt: timestamp("absolute_expires_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    lastSeenAt: timestamp("last_seen_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
      mode: "string",
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_sessions_token_hash_unique").on(table.tokenHash),
    index("auth_sessions_account_active_idx")
      .on(table.accountId)
      .where(sql`${table.revokedAt} is null`),
    index("auth_sessions_active_expiry_idx")
      .on(table.idleExpiresAt, table.absoluteExpiresAt, table.id)
      .where(sql`${table.revokedAt} is null`),
    index("auth_sessions_revoked_cleanup_idx")
      .on(table.revokedAt, table.id)
      .where(sql`${table.revokedAt} is not null`),
    check(
      "auth_sessions_expiry_order_check",
      sql`${table.idleExpiresAt} <= ${table.absoluteExpiresAt}`,
    ),
  ],
);

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: uuid("id").primaryKey(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => authAccounts.id, { onDelete: "cascade" }),
    purpose: authTokenPurpose("purpose").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    signingKeyVersion: integer("signing_key_version").notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    consumedAt: timestamp("consumed_at", {
      withTimezone: true,
      mode: "string",
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("auth_tokens_token_hash_unique").on(table.tokenHash),
    index("auth_tokens_account_purpose_active_idx")
      .on(
        table.accountId,
        table.purpose,
        table.createdAt.desc(),
        table.id.desc(),
      )
      .where(sql`${table.consumedAt} is null`),
    index("auth_tokens_expiry_cleanup_idx").on(table.expiresAt, table.id),
    check(
      "auth_tokens_signing_key_version_check",
      sql`${table.signingKeyVersion} > 0`,
    ),
  ],
);

export const authRateLimits = pgTable(
  "auth_rate_limits",
  {
    scope: varchar("scope", { length: 64 }).notNull(),
    keyHash: varchar("key_hash", { length: 64 }).notNull(),
    bucketStartedAt: timestamp("bucket_started_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    count: integer("count").notNull().default(1),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
  },
  (table) => [
    primaryKey({
      name: "auth_rate_limits_pkey",
      columns: [table.scope, table.keyHash, table.bucketStartedAt],
    }),
    index("auth_rate_limits_expiry_cleanup_idx").on(
      table.expiresAt,
      table.scope,
      table.keyHash,
    ),
    check("auth_rate_limits_count_check", sql`${table.count} > 0`),
  ],
);

export const authEmailJobs = pgTable(
  "auth_email_jobs",
  {
    id: uuid("id").primaryKey(),
    kind: authTokenPurpose("kind").notNull(),
    accountId: uuid("account_id")
      .notNull()
      .references(() => authAccounts.id, { onDelete: "cascade" }),
    authTokenId: uuid("auth_token_id")
      .notNull()
      .references(() => authTokens.id, { onDelete: "cascade" }),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    availableAt: timestamp("available_at", {
      withTimezone: true,
      mode: "string",
    }).notNull(),
    leasedUntil: timestamp("leased_until", {
      withTimezone: true,
      mode: "string",
    }),
    attemptCount: integer("attempt_count").notNull().default(0),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "string" }),
    lastErrorCode: varchar("last_error_code", { length: 64 }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("auth_email_jobs_idempotency_key_unique").on(
      table.idempotencyKey,
    ),
    index("auth_email_jobs_due_idx")
      .on(table.availableAt, table.id)
      .where(sql`${table.sentAt} is null and ${table.attemptCount} < 10`),
    check(
      "auth_email_jobs_attempt_count_check",
      sql`${table.attemptCount} between 0 and 10`,
    ),
  ],
);
