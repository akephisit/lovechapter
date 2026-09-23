import type {
  AuthenticatedUser,
  BulkGuestResult,
  CreateGuestAffiliationInput,
  CreateGuestInput,
  CreateWeddingInput,
  GuestAffiliation,
  GuestCsvRow,
  GuestDetail,
  GuestSummary,
  InvitationCreated,
  Page,
  PublicInvitation,
  RsvpResponse,
  SubmitRsvpInput,
  UpdateGuestAffiliationInput,
  UpdateProfileInput,
  WeddingSummary,
} from "@lovechapter/contracts";
import {
  ConflictError,
  DomainValidationError,
  encodeCursor,
  NotFoundError,
  type CreateInvitationRecord,
  type LoveChapterRepository,
  type GuestListRepositoryInput,
  type GuestExportPageRow,
  type NormalizedGuestUpdate,
  type Principal,
  type RepositoryPageInput,
  type RsvpWriteResult,
} from "@lovechapter/domain";
import type { SQL } from "drizzle-orm";

import {
  buildArchiveGuestQuery,
  buildBulkArchiveGuestsQuery,
  buildBulkSetGuestAffiliationQuery,
  buildCreateGuestAffiliationQuery,
  buildCreateGuestQuery,
  buildCreateInvitationQuery,
  buildLockInvitationGuestQuery,
  buildCreateOwnerMembershipQuery,
  buildCreateWeddingQuery,
  buildDeleteGuestAffiliationQuery,
  buildDeleteGuestPostalAddressQuery,
  buildGetGuestQuery,
  buildListGuestAffiliationsQuery,
  buildListGuestsQuery,
  buildListGuestExportPageQuery,
  buildListWeddingsQuery,
  buildPublicInvitationQuery,
  buildLockGuestAffiliationScopeQuery,
  buildReorderGuestAffiliationsQuery,
  buildRestoreGuestQuery,
  buildRevokeGuestInvitationsQuery,
  buildSetGuestAffiliationQuery,
  buildSyncUserQuery,
  buildUpdateGuestAffiliationQuery,
  buildUpdateGuestQuery,
  buildUpdateUserProfileQuery,
  buildUpsertRsvpQuery,
  buildUpsertGuestPostalAddressQuery,
  buildUnassignGuestAffiliationQuery,
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
    return toAuthenticatedUser(row, principal.provider === "development");
  }

  async updateUserProfile(
    userId: string,
    input: UpdateProfileInput,
  ): Promise<AuthenticatedUser> {
    const result = await this.executor.execute<UserRow>(
      buildUpdateUserProfileQuery({ userId, displayName: input.displayName }),
    );
    return toAuthenticatedUser(
      requiredRow(result.rows, "Profile update failed"),
    );
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
    input: GuestListRepositoryInput,
  ): Promise<Page<GuestSummary>> {
    const result = await this.executor.execute<GuestRow>(
      buildListGuestsQuery({ userId, weddingId, ...input }),
    );
    if (result.rows.length === 0) throw new NotFoundError("Wedding not found");
    const guestRows = result.rows.filter(isMaterializedGuestRow);
    return toPage(guestRows.map(mapGuest), input.limit);
  }

  async listGuestExportPage(
    userId: string,
    weddingId: string,
    input: GuestListRepositoryInput & { limit: 500 },
  ): Promise<Page<GuestExportPageRow>> {
    const result = await this.executor.execute<GuestExportRow>(
      buildListGuestExportPageQuery({ userId, weddingId, ...input }),
    );
    if (result.rows.length === 0) throw new NotFoundError("Wedding not found");
    const rows = result.rows.filter(isMaterializedGuestExportRow);
    const hasMore = rows.length > input.limit;
    const pageRows = hasMore ? rows.slice(0, input.limit) : rows;
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(mapGuestExportRow),
      nextCursor:
        hasMore && last
          ? encodeCursor({
              createdAt: asTimestamp(last.cursor_created_at),
              id: last.cursor_id,
            })
          : null,
    };
  }

  async listGuestAffiliations(
    userId: string,
    weddingId: string,
  ): Promise<GuestAffiliation[]> {
    const result = await this.executor.execute<GuestAffiliationListRow>(
      buildListGuestAffiliationsQuery({ userId, weddingId }),
    );
    if (result.rows.length === 0) throw new NotFoundError("Wedding not found");
    const affiliations = result.rows
      .filter(isMaterializedGuestAffiliationRow)
      .map(mapGuestAffiliation);
    if (affiliations.length > 100) {
      throw new DomainValidationError(
        "A wedding can have at most 100 guest affiliations",
      );
    }
    return affiliations;
  }

  async createGuestAffiliation(
    userId: string,
    weddingId: string,
    id: string,
    input: CreateGuestAffiliationInput,
  ): Promise<GuestAffiliation> {
    try {
      return await this.executor.transaction(async (transaction) => {
        const scope = await transaction.execute<{ wedding_id: string }>(
          buildLockGuestAffiliationScopeQuery({ userId, weddingId }),
        );
        if (!scope.rows[0]) throw new NotFoundError("Wedding not found");
        const result = await transaction.execute<GuestAffiliationRow>(
          buildCreateGuestAffiliationQuery({
            id,
            userId,
            weddingId,
            ...input,
          }),
        );
        const row = result.rows[0];
        if (!row) {
          throw new DomainValidationError(
            "A wedding can have at most 100 guest affiliations",
          );
        }
        return mapGuestAffiliation(row);
      });
    } catch (error) {
      if (isPostgresError(error, "23505")) {
        throw new ConflictError("Guest affiliation already exists");
      }
      throw error;
    }
  }

  async updateGuestAffiliation(
    userId: string,
    weddingId: string,
    affiliationId: string,
    input: UpdateGuestAffiliationInput,
  ): Promise<GuestAffiliation> {
    try {
      const result = await this.executor.execute<GuestAffiliationRow>(
        buildUpdateGuestAffiliationQuery({
          userId,
          weddingId,
          affiliationId,
          ...input,
        }),
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundError("Guest affiliation not found");
      return mapGuestAffiliation(row);
    } catch (error) {
      if (isPostgresError(error, "23505")) {
        throw new ConflictError("Guest affiliation already exists");
      }
      throw error;
    }
  }

  async reorderGuestAffiliations(
    userId: string,
    weddingId: string,
    affiliationIds: string[],
  ): Promise<GuestAffiliation[]> {
    return this.executor.transaction(async (transaction) => {
      const scope = await transaction.execute<{ wedding_id: string }>(
        buildLockGuestAffiliationScopeQuery({ userId, weddingId }),
      );
      if (!scope.rows[0]) throw new NotFoundError("Wedding not found");
      const result = await transaction.execute<GuestAffiliationListRow>(
        buildReorderGuestAffiliationsQuery({
          userId,
          weddingId,
          affiliationIds,
        }),
      );
      if (result.rows.length === 0) {
        throw new DomainValidationError("Invalid guest affiliation order");
      }
      return result.rows
        .filter(isMaterializedGuestAffiliationRow)
        .map(mapGuestAffiliation);
    });
  }

  async deleteGuestAffiliation(
    userId: string,
    weddingId: string,
    affiliationId: string,
  ): Promise<void> {
    await this.executor.transaction(async (transaction) => {
      const scope = await transaction.execute<{ wedding_id: string }>(
        buildLockGuestAffiliationScopeQuery({
          userId,
          weddingId,
          affiliationId,
        }),
      );
      if (!scope.rows[0]) {
        throw new NotFoundError("Guest affiliation not found");
      }
      await transaction.execute(
        buildUnassignGuestAffiliationQuery({
          userId,
          weddingId,
          affiliationId,
        }),
      );
      const result = await transaction.execute<{ id: string }>(
        buildDeleteGuestAffiliationQuery({
          userId,
          weddingId,
          affiliationId,
        }),
      );
      if (!result.rows[0]) {
        throw new NotFoundError("Guest affiliation not found");
      }
    });
  }

  async createGuest(
    userId: string,
    weddingId: string,
    id: string,
    input: CreateGuestInput,
  ): Promise<GuestSummary> {
    return this.executor.transaction(async (transaction) => {
      if (input.affiliationId) {
        const scope = await transaction.execute<{ wedding_id: string }>(
          buildLockGuestAffiliationScopeQuery({
            userId,
            weddingId,
            affiliationId: input.affiliationId,
          }),
        );
        if (!scope.rows[0]) {
          throw new NotFoundError("Wedding or guest affiliation not found");
        }
      }
      const result = await transaction.execute<GuestWriteRow>(
        buildCreateGuestQuery({
          id,
          userId,
          weddingId,
          name: input.name,
          email: input.email ?? null,
          phone: input.phone ?? null,
          allowedPartySize: input.allowedPartySize,
          affiliationId: input.affiliationId ?? null,
          envelopeName: input.envelopeName ?? null,
          note: input.note ?? null,
        }),
      );
      const row = result.rows[0];
      if (!row)
        throw new NotFoundError("Wedding or guest affiliation not found");
      if (input.postalAddress) {
        await transaction.execute(
          buildUpsertGuestPostalAddressQuery({
            userId,
            weddingId,
            guestId: id,
            postalAddress: input.postalAddress,
          }),
        );
      }
      return mapGuest({
        ...row,
        rsvp_attendance: null,
        rsvp_party_size: null,
        rsvp_note: null,
        rsvp_updated_at: null,
      });
    });
  }

  async setGuestAffiliation(
    userId: string,
    weddingId: string,
    guestId: string,
    affiliationId: string | null,
  ): Promise<GuestSummary> {
    return this.executor.transaction(async (transaction) => {
      const scope = await transaction.execute<{ wedding_id: string }>(
        buildLockGuestAffiliationScopeQuery({
          userId,
          weddingId,
          ...(affiliationId ? { affiliationId } : {}),
        }),
      );
      if (!scope.rows[0]) {
        throw new NotFoundError("Guest or guest affiliation not found");
      }
      const result = await transaction.execute<GuestRow>(
        buildSetGuestAffiliationQuery({
          userId,
          weddingId,
          guestId,
          affiliationId,
        }),
      );
      const row = result.rows[0];
      if (!row || !isMaterializedGuestRow(row)) {
        throw new NotFoundError("Guest or guest affiliation not found");
      }
      return mapGuest(row);
    });
  }

  async getGuest(
    userId: string,
    weddingId: string,
    guestId: string,
  ): Promise<GuestDetail> {
    return loadGuestDetail(this.executor, { userId, weddingId, guestId });
  }

  async updateGuest(
    userId: string,
    weddingId: string,
    guestId: string,
    patch: NormalizedGuestUpdate,
  ): Promise<GuestDetail> {
    return this.executor.transaction(async (transaction) => {
      const result = await transaction.execute<{ id: string }>(
        buildUpdateGuestQuery({ userId, weddingId, guestId, patch }),
      );
      if (!result.rows[0]) throw new NotFoundError("Guest not found");
      if (patch.postalAddress !== undefined) {
        await transaction.execute(
          patch.postalAddress
            ? buildUpsertGuestPostalAddressQuery({
                userId,
                weddingId,
                guestId,
                postalAddress: patch.postalAddress,
              })
            : buildDeleteGuestPostalAddressQuery({
                userId,
                weddingId,
                guestId,
              }),
        );
      }
      return loadGuestDetail(transaction, { userId, weddingId, guestId });
    });
  }

  async archiveGuest(
    userId: string,
    weddingId: string,
    guestId: string,
  ): Promise<GuestDetail> {
    return this.executor.transaction(async (transaction) => {
      const result = await transaction.execute<{ id: string }>(
        buildArchiveGuestQuery({ userId, weddingId, guestId }),
      );
      if (!result.rows[0]) throw new NotFoundError("Guest not found");
      await transaction.execute(
        buildRevokeGuestInvitationsQuery({
          userId,
          weddingId,
          guestIds: [guestId],
        }),
      );
      return loadGuestDetail(transaction, { userId, weddingId, guestId });
    });
  }

  async restoreGuest(
    userId: string,
    weddingId: string,
    guestId: string,
  ): Promise<GuestDetail> {
    return this.executor.transaction(async (transaction) => {
      const result = await transaction.execute<{ id: string }>(
        buildRestoreGuestQuery({ userId, weddingId, guestId }),
      );
      if (!result.rows[0]) throw new NotFoundError("Guest not found");
      return loadGuestDetail(transaction, { userId, weddingId, guestId });
    });
  }

  async bulkSetGuestAffiliation(
    userId: string,
    weddingId: string,
    guestIds: string[],
    affiliationId: string | null,
  ): Promise<BulkGuestResult> {
    const result = await this.executor.execute<BulkGuestRow>(
      buildBulkSetGuestAffiliationQuery({
        userId,
        weddingId,
        guestIds,
        affiliationId,
      }),
    );
    return requireCompleteBulkResult(result.rows[0], guestIds.length);
  }

  async bulkArchiveGuests(
    userId: string,
    weddingId: string,
    guestIds: string[],
  ): Promise<BulkGuestResult> {
    return this.executor.transaction(async (transaction) => {
      const result = await transaction.execute<BulkGuestRow>(
        buildBulkArchiveGuestsQuery({ userId, weddingId, guestIds }),
      );
      const complete = requireCompleteBulkResult(
        result.rows[0],
        guestIds.length,
      );
      await transaction.execute(
        buildRevokeGuestInvitationsQuery({ userId, weddingId, guestIds }),
      );
      return complete;
    });
  }

  async createInvitation(
    input: CreateInvitationRecord,
  ): Promise<Omit<InvitationCreated, "token" | "publicUrl">> {
    try {
      return await this.executor.transaction(async (transaction) => {
        const locked = await transaction.execute<{ id: string }>(
          buildLockInvitationGuestQuery({
            userId: input.createdByUserId,
            weddingId: input.weddingId,
            guestId: input.guestId,
          }),
        );
        if (!locked.rows[0]) throw new NotFoundError("Guest not found");
        const result = await transaction.execute<InvitationWriteRow>(
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
      });
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
  const guest: GuestSummary = {
    id: row.id,
    name: row.name,
    allowedPartySize: Number(row.allowed_party_size),
    affiliation: mapNullableGuestAffiliation(row),
    createdAt: asTimestamp(row.created_at),
    rsvp: mapNullableRsvp(row),
  };
  if (row.email) guest.email = row.email;
  if (row.phone) guest.phone = row.phone;
  if (row.archived_at) guest.archivedAt = asTimestamp(row.archived_at);
  return guest;
}

async function loadGuestDetail(
  executor: QueryExecutor,
  input: { userId: string; weddingId: string; guestId: string },
): Promise<GuestDetail> {
  const result = await executor.execute<GuestDetailRow>(
    buildGetGuestQuery(input),
  );
  const row = result.rows[0];
  if (!row) throw new NotFoundError("Guest not found");
  const detail: GuestDetail = {
    ...mapGuest(row),
    postalAddress: row.address_line_1
      ? {
          addressLine1: row.address_line_1,
          ...(row.address_line_2 ? { addressLine2: row.address_line_2 } : {}),
          ...(row.locality ? { locality: row.locality } : {}),
          ...(row.administrative_area
            ? { administrativeArea: row.administrative_area }
            : {}),
          ...(row.postal_code ? { postalCode: row.postal_code } : {}),
          ...(row.country_code ? { countryCode: row.country_code } : {}),
        }
      : null,
    updatedAt: asTimestamp(row.updated_at),
  };
  if (row.envelope_name) detail.envelopeName = row.envelope_name;
  if (row.note) detail.note = row.note;
  return detail;
}

function requireCompleteBulkResult(
  row: BulkGuestRow | undefined,
  expected: number,
): BulkGuestResult {
  if (!row || Number(row.affected) !== expected) {
    throw new NotFoundError("One or more guests were not found");
  }
  return { affected: expected };
}

function mapGuestAffiliation(row: GuestAffiliationRow): GuestAffiliation {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    sortOrder: Number(row.sort_order),
    createdAt: asTimestamp(row.created_at),
  };
}

function mapNullableGuestAffiliation(
  row: GuestAffiliationColumns,
): GuestAffiliation | null {
  if (
    !row.affiliation_id ||
    !row.affiliation_name ||
    !row.affiliation_color ||
    row.affiliation_sort_order === null ||
    !row.affiliation_created_at
  ) {
    return null;
  }
  return {
    id: row.affiliation_id,
    name: row.affiliation_name,
    color: row.affiliation_color,
    sortOrder: Number(row.affiliation_sort_order),
    createdAt: asTimestamp(row.affiliation_created_at),
  };
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

function toAuthenticatedUser(
  row: UserRow,
  developmentIdentity = false,
): AuthenticatedUser {
  const user = {
    id: row.id,
    displayName: row.display_name,
    onboardingComplete:
      developmentIdentity || row.onboarding_completed_at !== null,
  };
  return row.email ? { ...user, email: row.email } : user;
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
  onboarding_completed_at: string | Date | null;
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
  phone: string | null;
  allowed_party_size: number;
  created_at: string | Date;
  archived_at: string | Date | null;
} & GuestAffiliationColumns;

type GuestAffiliationRow = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  created_at: string | Date;
};

type GuestAffiliationListRow = {
  authorized?: boolean;
  id: string | null;
  name: string | null;
  color: string | null;
  sort_order: number | null;
  created_at: string | Date | null;
};

type MaterializedGuestAffiliationRow = GuestAffiliationListRow &
  GuestAffiliationRow;

function isMaterializedGuestAffiliationRow(
  row: GuestAffiliationListRow,
): row is MaterializedGuestAffiliationRow {
  return (
    row.id !== null &&
    row.name !== null &&
    row.color !== null &&
    row.sort_order !== null &&
    row.created_at !== null
  );
}

type GuestAffiliationColumns = {
  affiliation_id: string | null;
  affiliation_name: string | null;
  affiliation_color: string | null;
  affiliation_sort_order: number | null;
  affiliation_created_at: string | Date | null;
};

type GuestRow = Omit<
  GuestWriteRow,
  "id" | "name" | "allowed_party_size" | "created_at"
> &
  NullableRsvpRow & {
    authorized?: boolean;
    id: string | null;
    name: string | null;
    phone: string | null;
    allowed_party_size: number | null;
    created_at: string | Date | null;
    archived_at: string | Date | null;
  };

type MaterializedGuestRow = GuestRow & {
  id: string;
  name: string;
  allowed_party_size: number;
  created_at: string | Date;
};

type GuestDetailRow = MaterializedGuestRow & {
  envelope_name: string | null;
  note: string | null;
  updated_at: string | Date;
  address_line_1: string | null;
  address_line_2: string | null;
  locality: string | null;
  administrative_area: string | null;
  postal_code: string | null;
  country_code: string | null;
};

type GuestExportRow = {
  authorized: boolean;
  cursor_id: string | null;
  cursor_created_at: string | Date | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  allowed_party_size: number | null;
  affiliation: string | null;
  envelope_name: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  locality: string | null;
  administrative_area: string | null;
  postal_code: string | null;
  country_code: string | null;
  note: string | null;
  rsvp_status: "attending" | "declined" | null;
  rsvp_party_size: number | null;
};

type MaterializedGuestExportRow = GuestExportRow & {
  cursor_id: string;
  cursor_created_at: string | Date;
  name: string;
  allowed_party_size: number;
};

function isMaterializedGuestExportRow(
  row: GuestExportRow,
): row is MaterializedGuestExportRow {
  return (
    row.cursor_id !== null &&
    row.cursor_created_at !== null &&
    row.name !== null &&
    row.allowed_party_size !== null
  );
}

function mapGuestExportRow(
  row: MaterializedGuestExportRow,
): GuestExportPageRow {
  const values: GuestCsvRow = {
    name: row.name,
    email: row.email,
    phone: row.phone,
    allowedPartySize: Number(row.allowed_party_size),
    affiliation: row.affiliation,
    envelopeName: row.envelope_name,
    addressLine1: row.address_line_1,
    addressLine2: row.address_line_2,
    locality: row.locality,
    administrativeArea: row.administrative_area,
    postalCode: row.postal_code,
    countryCode: row.country_code,
    note: row.note,
    rsvpStatus: row.rsvp_status,
    rsvpPartySize:
      row.rsvp_party_size === null ? null : Number(row.rsvp_party_size),
  };
  return {
    ...values,
    cursorId: row.cursor_id,
    cursorCreatedAt: asTimestamp(row.cursor_created_at),
  };
}

type BulkGuestRow = { affected: number | string };

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
