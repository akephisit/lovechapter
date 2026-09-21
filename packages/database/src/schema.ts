import { sql } from "drizzle-orm";
import {
  check,
  date,
  foreignKey,
  index,
  integer,
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

export const guests = pgTable(
  "guests",
  {
    id: uuid("id").notNull(),
    weddingId: uuid("wedding_id")
      .notNull()
      .references(() => weddings.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 120 }).notNull(),
    email: varchar("email", { length: 320 }),
    allowedPartySize: integer("allowed_party_size").notNull().default(1),
    ...timestamps,
  },
  (table) => [
    primaryKey({ name: "guests_pkey", columns: [table.weddingId, table.id] }),
    check(
      "guests_allowed_party_size_check",
      sql`${table.allowedPartySize} between 1 and 20`,
    ),
    index("guests_wedding_created_idx").on(
      table.weddingId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
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
