import type {
  AuthenticatedUser,
  CreateGuestInput,
  CreateWeddingInput,
  GuestSummary,
  InvitationCreated,
  Page,
  PublicInvitation,
  RsvpResponse,
  SubmitRsvpInput,
  WeddingSummary,
} from "@lovechapter/contracts";
import {
  ConflictError,
  encodeCursor,
  NotFoundError,
  type CreateInvitationRecord,
  type LoveChapterRepository,
  type Principal,
  type RepositoryPageInput,
  type RsvpWriteResult,
} from "@lovechapter/domain";
import type { SQL } from "drizzle-orm";

import {
  buildCreateGuestQuery,
  buildCreateInvitationQuery,
  buildCreateOwnerMembershipQuery,
  buildCreateWeddingQuery,
  buildListGuestsQuery,
  buildListWeddingsQuery,
  buildPublicInvitationQuery,
  buildSyncUserQuery,
  buildUpsertRsvpQuery,
} from "./queries";

export interface QueryExecutor {
  execute<T extends Record<string, unknown>>(
    query: SQL,
  ): Promise<{ rows: T[] }>;
  transaction<T>(
    operation: (executor: QueryExecutor) => Promise<T>,
  ): Promise<T>;
}

export class PostgresLoveChapterRepository implements LoveChapterRepository {
  constructor(private readonly executor: QueryExecutor) {}

  async syncUser(principal: Principal): Promise<AuthenticatedUser> {
    const result = await this.executor.execute<UserRow>(
      buildSyncUserQuery({
        id: crypto.randomUUID(),
        provider: principal.provider,
        subject: principal.subject,
        displayName: principal.displayName,
        email: principal.email ?? null,
      }),
    );
    const row = requiredRow(result.rows, "Identity synchronization failed");
    return row.email
      ? { id: row.id, displayName: row.display_name, email: row.email }
      : { id: row.id, displayName: row.display_name };
  }

  async listWeddings(
    userId: string,
    page: RepositoryPageInput,
  ): Promise<Page<WeddingSummary>> {
    const result = await this.executor.execute<WeddingListRow>(
      buildListWeddingsQuery({ userId, ...page }),
    );
    return toWeddingPage(result.rows, page.limit);
  }

  async createWedding(
    userId: string,
    id: string,
    input: CreateWeddingInput,
  ): Promise<WeddingSummary> {
    return this.executor.transaction(async (transaction) => {
      const result = await transaction.execute<WeddingRow>(
        buildCreateWeddingQuery({
          id,
          userId,
          name: input.name,
          weddingDate: input.weddingDate ?? null,
          timeZone: input.timeZone,
          locale: input.locale,
        }),
      );
      const row = requiredRow(result.rows, "Wedding creation failed");
      await transaction.execute(
        buildCreateOwnerMembershipQuery({ userId, weddingId: id }),
      );
      return mapWedding({ ...row, role: "owner" });
    });
  }

  async listGuests(
    userId: string,
    weddingId: string,
    page: RepositoryPageInput,
  ): Promise<Page<GuestSummary>> {
    const result = await this.executor.execute<GuestRow>(
      buildListGuestsQuery({ userId, weddingId, ...page }),
    );
    if (result.rows.length === 0) throw new NotFoundError("Wedding not found");
    const guestRows = result.rows.filter(isMaterializedGuestRow);
    return toPage(guestRows.map(mapGuest), page.limit);
  }

  async createGuest(
    userId: string,
    weddingId: string,
    id: string,
    input: CreateGuestInput,
  ): Promise<GuestSummary> {
    const result = await this.executor.execute<GuestWriteRow>(
      buildCreateGuestQuery({
        id,
        userId,
        weddingId,
        name: input.name,
        email: input.email ?? null,
        allowedPartySize: input.allowedPartySize,
      }),
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError("Wedding not found");
    return mapGuest({
      ...row,
      rsvp_attendance: null,
      rsvp_party_size: null,
      rsvp_note: null,
      rsvp_updated_at: null,
    });
  }

  async createInvitation(
    input: CreateInvitationRecord,
  ): Promise<Omit<InvitationCreated, "token" | "publicUrl">> {
    try {
      const result = await this.executor.execute<InvitationWriteRow>(
        buildCreateInvitationQuery({
          id: input.id,
          userId: input.createdByUserId,
          weddingId: input.weddingId,
          guestId: input.guestId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt ?? null,
        }),
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundError("Guest not found");
      return row.expires_at
        ? {
            id: row.id,
            guestId: row.guest_id,
            expiresAt: asTimestamp(row.expires_at),
          }
        : { id: row.id, guestId: row.guest_id };
    } catch (error) {
      if (isPostgresError(error, "23505")) {
        throw new ConflictError("Guest already has an active invitation");
      }
      throw error;
    }
  }

  async findPublicInvitation(
    tokenHash: string,
  ): Promise<PublicInvitation | null> {
    const result = await this.executor.execute<PublicInvitationRow>(
      buildPublicInvitationQuery(tokenHash),
    );
    const row = result.rows[0];
    if (!row) return null;
    const wedding = row.wedding_date
      ? {
          name: row.wedding_name,
          weddingDate: row.wedding_date,
          timeZone: row.time_zone,
          locale: row.locale,
        }
      : {
          name: row.wedding_name,
          timeZone: row.time_zone,
          locale: row.locale,
        };
    return {
      invitationId: row.invitation_id,
      guest: { name: row.guest_name, allowedPartySize: row.allowed_party_size },
      wedding,
      rsvp: mapNullableRsvp(row),
    };
  }

  async upsertRsvp(
    tokenHash: string,
    id: string,
    input: SubmitRsvpInput,
  ): Promise<RsvpWriteResult> {
    const result = await this.executor.execute<RsvpWriteRow>(
      buildUpsertRsvpQuery({
        id,
        tokenHash,
        attendance: input.attendance,
        partySize: input.partySize,
        note: input.note ?? null,
      }),
    );
    const row = requiredRow(result.rows, "RSVP write failed");
    if (row.kind === "not_found") return { kind: "not_found" };
    if (row.kind === "invalid_party_size") {
      return {
        kind: "invalid_party_size",
        allowedPartySize: Number(row.allowed_party_size),
      };
    }
    return {
      kind: "saved",
      value: mapRsvp(row),
    };
  }
}

function toPage<T extends { id: string; createdAt: string }>(
  rows: T[],
  limit: number,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return {
    items,
    nextCursor:
      hasMore && last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : null,
  };
}

function toWeddingPage(
  rows: WeddingListRow[],
  limit: number,
): Page<WeddingSummary> {
  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows.at(-1);
  return {
    items: pageRows.map(mapWedding),
    nextCursor:
      hasMore && last
        ? encodeCursor({
            createdAt: asTimestamp(last.cursor_created_at),
            id: last.id,
          })
        : null,
  };
}

function mapWedding(row: WeddingRow): WeddingSummary {
  const common = {
    id: row.id,
    name: row.name,
    timeZone: row.time_zone,
    locale: row.locale,
    role: row.role ?? ("owner" as const),
    createdAt: asTimestamp(row.created_at),
  };
  return row.wedding_date
    ? { ...common, weddingDate: row.wedding_date }
    : common;
}

function mapGuest(row: MaterializedGuestRow): GuestSummary {
  const common = {
    id: row.id,
    name: row.name,
    allowedPartySize: Number(row.allowed_party_size),
    createdAt: asTimestamp(row.created_at),
    rsvp: mapNullableRsvp(row),
  };
  return row.email ? { ...common, email: row.email } : common;
}

function mapNullableRsvp(row: NullableRsvpRow): RsvpResponse | null {
  if (
    !row.rsvp_attendance ||
    row.rsvp_party_size === null ||
    !row.rsvp_updated_at
  ) {
    return null;
  }
  const common = {
    attendance: row.rsvp_attendance,
    partySize: Number(row.rsvp_party_size),
    updatedAt: asTimestamp(row.rsvp_updated_at),
  };
  return row.rsvp_note ? { ...common, note: row.rsvp_note } : common;
}

function mapRsvp(row: RsvpWriteRow): RsvpResponse {
  if (!row.attendance || row.party_size === null || !row.updated_at) {
    throw new Error("Database returned an incomplete saved RSVP");
  }
  const common = {
    attendance: row.attendance,
    partySize: Number(row.party_size),
    updatedAt: asTimestamp(row.updated_at),
  };
  return row.note ? { ...common, note: row.note } : common;
}

function requiredRow<T>(rows: T[], message: string): T {
  const row = rows[0];
  if (!row) throw new Error(message);
  return row;
}

function asTimestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function isPostgresError(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

type UserRow = {
  id: string;
  display_name: string;
  email: string | null;
};

type WeddingRow = {
  id: string;
  name: string;
  wedding_date: string | null;
  time_zone: string;
  locale: string;
  role?: "owner" | "couple" | "planner" | "collaborator";
  created_at: string | Date;
};

type WeddingListRow = WeddingRow & {
  cursor_created_at: string | Date;
};

type NullableRsvpRow = {
  rsvp_attendance: "attending" | "declined" | null;
  rsvp_party_size: number | null;
  rsvp_note: string | null;
  rsvp_updated_at: string | Date | null;
};

type GuestWriteRow = {
  id: string;
  name: string;
  email: string | null;
  allowed_party_size: number;
  created_at: string | Date;
};

type GuestRow = Omit<
  GuestWriteRow,
  "id" | "name" | "allowed_party_size" | "created_at"
> &
  NullableRsvpRow & {
    authorized?: boolean;
    id: string | null;
    name: string | null;
    allowed_party_size: number | null;
    created_at: string | Date | null;
  };

type MaterializedGuestRow = GuestRow & {
  id: string;
  name: string;
  allowed_party_size: number;
  created_at: string | Date;
};

function isMaterializedGuestRow(row: GuestRow): row is MaterializedGuestRow {
  return (
    row.id !== null &&
    row.name !== null &&
    row.allowed_party_size !== null &&
    row.created_at !== null
  );
}

type InvitationWriteRow = {
  id: string;
  guest_id: string;
  expires_at: string | Date | null;
};

type PublicInvitationRow = NullableRsvpRow & {
  invitation_id: string;
  guest_name: string;
  allowed_party_size: number;
  wedding_name: string;
  wedding_date: string | null;
  time_zone: string;
  locale: string;
};

type RsvpWriteRow = {
  kind: "saved" | "invalid_party_size" | "not_found";
  attendance: "attending" | "declined" | null;
  party_size: number | null;
  note: string | null;
  updated_at: string | Date | null;
  allowed_party_size: number | null;
};
