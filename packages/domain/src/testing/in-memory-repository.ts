import type {
  AuthenticatedUser,
  BulkGuestResult,
  CreateGuestAffiliationInput,
  CreateGuestInput,
  CreateWeddingInput,
  GuestAffiliation,
  GuestDetail,
  GuestCsvRow,
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

export { InMemoryEnvelopeRepository } from "./in-memory-envelope-repository";
export { InMemoryPlanningRepository } from "./in-memory-planning-repository";

export { InMemoryGuestImportRepository } from "./in-memory-guest-import-repository";

import { encodeCursor } from "../cursor";
import { ConflictError, DomainValidationError, NotFoundError } from "../errors";
import type { Principal } from "../identity";
import type {
  CreateInvitationRecord,
  GuestExportPageRow,
  GuestListRepositoryInput,
  LoveChapterRepository,
  NormalizedGuestUpdate,
  RepositoryPageInput,
  RsvpWriteResult,
} from "../ports";

type WeddingRecord = {
  summary: WeddingSummary;
  members: Set<string>;
};

type GuestRecord = {
  weddingId: string;
  detail: GuestDetail;
};

type InvitationRecord = CreateInvitationRecord & {
  expired: boolean;
};

export class InMemoryLoveChapterRepository implements LoveChapterRepository {
  private readonly usersByIdentity = new Map<string, AuthenticatedUser>();
  private readonly weddings = new Map<string, WeddingRecord>();
  private readonly guests = new Map<string, GuestRecord>();
  private readonly guestAffiliations = new Map<
    string,
    { weddingId: string; summary: GuestAffiliation }
  >();
  private readonly invitations = new Map<string, InvitationRecord>();
  private readonly rsvpsByGuest = new Map<string, RsvpResponse>();
  private readonly now: () => Date;
  lastGuestUpdate: NormalizedGuestUpdate | undefined;

  constructor(options?: { now?: () => Date }) {
    this.now = options?.now ?? (() => new Date());
  }

  async syncUser(principal: Principal): Promise<AuthenticatedUser> {
    const key = `${principal.provider}:${principal.subject}`;
    const existing = this.usersByIdentity.get(key);
    if (existing) {
      if (!principal.email || principal.email === existing.email) {
        return existing;
      }
      const updated = { ...existing, email: principal.email };
      this.usersByIdentity.set(key, updated);
      return updated;
    }
    // Local registration seeds the user profile and onboarding timestamp in the
    // same transaction as the auth account. Mirror that production invariant so
    // in-process vertical-slice tests do not require a second profile step.
    const onboardingComplete =
      principal.provider === "development" || principal.provider === "local";
    const user: AuthenticatedUser = principal.email
      ? {
          id: crypto.randomUUID(),
          displayName: principal.displayName,
          email: principal.email,
          onboardingComplete,
        }
      : {
          id: crypto.randomUUID(),
          displayName: principal.displayName,
          onboardingComplete,
        };
    this.usersByIdentity.set(key, user);
    return user;
  }

  async updateUserProfile(
    userId: string,
    input: UpdateProfileInput,
  ): Promise<AuthenticatedUser> {
    const entry = [...this.usersByIdentity.entries()].find(
      ([, user]) => user.id === userId,
    );
    if (!entry) throw new NotFoundError("User not found");
    const [key, user] = entry;
    const updated = {
      ...user,
      displayName: input.displayName,
      onboardingComplete: true,
    };
    this.usersByIdentity.set(key, updated);
    return updated;
  }

  async listWeddings(
    userId: string,
    page: RepositoryPageInput,
  ): Promise<Page<WeddingSummary>> {
    return paginate(
      [...this.weddings.values()]
        .filter((record) => record.members.has(userId))
        .map((record) => record.summary),
      page,
    );
  }

  async createWedding(
    userId: string,
    id: string,
    input: CreateWeddingInput,
  ): Promise<WeddingSummary> {
    const createdAt = this.now().toISOString();
    const summary: WeddingSummary = input.weddingDate
      ? { ...input, id, role: "owner", createdAt }
      : {
          id,
          name: input.name,
          timeZone: input.timeZone,
          locale: input.locale,
          role: "owner",
          createdAt,
        };
    this.weddings.set(id, { summary, members: new Set([userId]) });
    return summary;
  }

  async listGuestAffiliations(
    userId: string,
    weddingId: string,
  ): Promise<GuestAffiliation[]> {
    this.requireMember(userId, weddingId);
    return this.affiliationsForWedding(weddingId);
  }

  async createGuestAffiliation(
    userId: string,
    weddingId: string,
    id: string,
    input: CreateGuestAffiliationInput,
  ): Promise<GuestAffiliation> {
    this.requireMember(userId, weddingId);
    const current = this.affiliationsForWedding(weddingId);
    if (current.length >= 100) {
      throw new DomainValidationError(
        "A wedding can have at most 100 guest affiliations",
      );
    }
    this.assertUniqueAffiliationName(weddingId, input.name);
    const summary: GuestAffiliation = {
      id,
      ...input,
      sortOrder: (current.at(-1)?.sortOrder ?? -1) + 1,
      createdAt: this.now().toISOString(),
    };
    this.guestAffiliations.set(id, { weddingId, summary });
    return summary;
  }

  async updateGuestAffiliation(
    userId: string,
    weddingId: string,
    affiliationId: string,
    input: UpdateGuestAffiliationInput,
  ): Promise<GuestAffiliation> {
    this.requireMember(userId, weddingId);
    const record = this.requireAffiliation(weddingId, affiliationId);
    this.assertUniqueAffiliationName(weddingId, input.name, affiliationId);
    const summary = { ...record.summary, ...input };
    this.guestAffiliations.set(affiliationId, { weddingId, summary });
    return summary;
  }

  async reorderGuestAffiliations(
    userId: string,
    weddingId: string,
    affiliationIds: string[],
  ): Promise<GuestAffiliation[]> {
    this.requireMember(userId, weddingId);
    const current = this.affiliationsForWedding(weddingId);
    if (
      current.length !== affiliationIds.length ||
      affiliationIds.some(
        (id) =>
          !this.guestAffiliations.get(id) ||
          this.guestAffiliations.get(id)?.weddingId !== weddingId,
      )
    ) {
      throw new DomainValidationError("Invalid guest affiliation order");
    }
    affiliationIds.forEach((id, sortOrder) => {
      const record = this.requireAffiliation(weddingId, id);
      this.guestAffiliations.set(id, {
        ...record,
        summary: { ...record.summary, sortOrder },
      });
    });
    return this.affiliationsForWedding(weddingId);
  }

  async deleteGuestAffiliation(
    userId: string,
    weddingId: string,
    affiliationId: string,
  ): Promise<void> {
    this.requireMember(userId, weddingId);
    this.requireAffiliation(weddingId, affiliationId);
    this.guestAffiliations.delete(affiliationId);
    for (const [guestId, record] of this.guests) {
      if (
        record.weddingId === weddingId &&
        record.detail.affiliation?.id === affiliationId
      ) {
        this.guests.set(guestId, {
          ...record,
          detail: { ...record.detail, affiliation: null },
        });
      }
    }
  }

  async listGuests(
    userId: string,
    weddingId: string,
    input: GuestListRepositoryInput,
  ): Promise<Page<GuestSummary>> {
    this.requireMember(userId, weddingId);
    const items = [...this.guests.values()]
      .filter(
        (record) =>
          record.weddingId === weddingId &&
          (input.view === "archived"
            ? Boolean(record.detail.archivedAt)
            : !record.detail.archivedAt),
      )
      .filter((record) =>
        matchesGuestFilters(record.detail, input, this.rsvpsByGuest),
      )
      .map((record) => guestSummary(record.detail, this.rsvpsByGuest));
    return paginate(items, input);
  }

  async listGuestExportPage(
    userId: string,
    weddingId: string,
    input: GuestListRepositoryInput & { limit: 500 },
  ): Promise<Page<GuestExportPageRow>> {
    this.requireMember(userId, weddingId);
    const rows = [...this.guests.values()]
      .filter(
        (record) =>
          record.weddingId === weddingId &&
          (input.view === "archived"
            ? Boolean(record.detail.archivedAt)
            : !record.detail.archivedAt) &&
          matchesGuestFilters(record.detail, input, this.rsvpsByGuest),
      )
      .map(({ detail }) => {
        const address = detail.postalAddress;
        const rsvp = this.rsvpsByGuest.get(detail.id);
        const row: GuestCsvRow = {
          name: detail.name,
          email: detail.email ?? null,
          phone: detail.phone ?? null,
          allowedPartySize: detail.allowedPartySize,
          affiliation: detail.affiliation?.name ?? null,
          envelopeName: detail.envelopeName ?? null,
          addressLine1: address?.addressLine1 ?? null,
          addressLine2: address?.addressLine2 ?? null,
          locality: address?.locality ?? null,
          administrativeArea: address?.administrativeArea ?? null,
          postalCode: address?.postalCode ?? null,
          countryCode: address?.countryCode ?? null,
          note: detail.note ?? null,
          rsvpStatus: rsvp?.attendance ?? null,
          rsvpPartySize: rsvp?.partySize ?? null,
        };
        return {
          ...row,
          id: detail.id,
          createdAt: detail.createdAt,
          cursorId: detail.id,
          cursorCreatedAt: detail.createdAt,
        };
      });
    const page = paginate(rows, input);
    return {
      ...page,
      items: page.items.map(({ id, createdAt, ...row }) => {
        void id;
        void createdAt;
        return row;
      }),
    };
  }

  async createGuest(
    userId: string,
    weddingId: string,
    id: string,
    input: CreateGuestInput,
  ): Promise<GuestSummary> {
    this.requireMember(userId, weddingId);
    const affiliation = input.affiliationId
      ? this.requireAffiliation(weddingId, input.affiliationId).summary
      : null;
    const timestamp = this.now().toISOString();
    const detail: GuestDetail = {
      id,
      name: input.name,
      allowedPartySize: input.allowedPartySize,
      affiliation,
      createdAt: timestamp,
      rsvp: null,
      postalAddress: input.postalAddress ?? null,
      updatedAt: timestamp,
    };
    if (input.email) detail.email = input.email;
    if (input.phone) detail.phone = input.phone;
    if (input.envelopeName) detail.envelopeName = input.envelopeName;
    if (input.note) detail.note = input.note;
    this.guests.set(id, { weddingId, detail });
    return guestSummary(detail, this.rsvpsByGuest);
  }

  async setGuestAffiliation(
    userId: string,
    weddingId: string,
    guestId: string,
    affiliationId: string | null,
  ): Promise<GuestSummary> {
    this.requireMember(userId, weddingId);
    const record = this.guests.get(guestId);
    if (!record || record.weddingId !== weddingId) {
      throw new NotFoundError("Guest not found");
    }
    const affiliation = affiliationId
      ? this.requireAffiliation(weddingId, affiliationId).summary
      : null;
    const detail = {
      ...record.detail,
      affiliation,
      updatedAt: this.now().toISOString(),
    };
    this.guests.set(guestId, { ...record, detail });
    return guestSummary(detail, this.rsvpsByGuest);
  }

  async getGuest(
    userId: string,
    weddingId: string,
    guestId: string,
  ): Promise<GuestDetail> {
    this.requireMember(userId, weddingId);
    const record = this.requireGuest(weddingId, guestId);
    return guestDetail(record.detail, this.rsvpsByGuest);
  }

  async updateGuest(
    userId: string,
    weddingId: string,
    guestId: string,
    input: NormalizedGuestUpdate,
  ): Promise<GuestDetail> {
    this.requireMember(userId, weddingId);
    const record = this.requireGuest(weddingId, guestId);
    const affiliation =
      input.affiliationId === undefined
        ? record.detail.affiliation
        : input.affiliationId
          ? this.requireAffiliation(weddingId, input.affiliationId).summary
          : null;
    const detail: GuestDetail = {
      ...record.detail,
      affiliation,
      updatedAt: this.now().toISOString(),
    };
    if (input.name !== undefined) detail.name = input.name;
    if (input.allowedPartySize !== undefined) {
      detail.allowedPartySize = input.allowedPartySize;
    }
    applyOptional(detail, "email", input.email);
    applyOptional(detail, "phone", input.phone);
    applyOptional(detail, "envelopeName", input.envelopeName);
    applyOptional(detail, "note", input.note);
    if (input.postalAddress !== undefined) {
      detail.postalAddress = input.postalAddress;
    }
    this.lastGuestUpdate = input;
    this.guests.set(guestId, { ...record, detail });
    return guestDetail(detail, this.rsvpsByGuest);
  }

  async archiveGuest(
    userId: string,
    weddingId: string,
    guestId: string,
  ): Promise<GuestDetail> {
    this.requireMember(userId, weddingId);
    const record = this.requireGuest(weddingId, guestId);
    const timestamp = this.now().toISOString();
    const detail = {
      ...record.detail,
      archivedAt: record.detail.archivedAt ?? timestamp,
      updatedAt: timestamp,
    };
    this.guests.set(guestId, { ...record, detail });
    this.revokeInvitations(weddingId, new Set([guestId]));
    return guestDetail(detail, this.rsvpsByGuest);
  }

  async restoreGuest(
    userId: string,
    weddingId: string,
    guestId: string,
  ): Promise<GuestDetail> {
    this.requireMember(userId, weddingId);
    const record = this.requireGuest(weddingId, guestId);
    const active = { ...record.detail };
    delete active.archivedAt;
    const detail: GuestDetail = {
      ...active,
      updatedAt: this.now().toISOString(),
    };
    this.guests.set(guestId, { ...record, detail });
    return guestDetail(detail, this.rsvpsByGuest);
  }

  async bulkSetGuestAffiliation(
    userId: string,
    weddingId: string,
    guestIds: string[],
    affiliationId: string | null,
  ): Promise<BulkGuestResult> {
    this.requireMember(userId, weddingId);
    const records = guestIds.map((guestId) =>
      this.requireGuest(weddingId, guestId),
    );
    const affiliation = affiliationId
      ? this.requireAffiliation(weddingId, affiliationId).summary
      : null;
    const timestamp = this.now().toISOString();
    guestIds.forEach((guestId, index) => {
      const record = records[index]!;
      this.guests.set(guestId, {
        ...record,
        detail: { ...record.detail, affiliation, updatedAt: timestamp },
      });
    });
    return { affected: guestIds.length };
  }

  async bulkArchiveGuests(
    userId: string,
    weddingId: string,
    guestIds: string[],
  ): Promise<BulkGuestResult> {
    this.requireMember(userId, weddingId);
    const records = guestIds.map((guestId) =>
      this.requireGuest(weddingId, guestId),
    );
    const timestamp = this.now().toISOString();
    guestIds.forEach((guestId, index) => {
      const record = records[index]!;
      this.guests.set(guestId, {
        ...record,
        detail: {
          ...record.detail,
          archivedAt: record.detail.archivedAt ?? timestamp,
          updatedAt: timestamp,
        },
      });
    });
    this.revokeInvitations(weddingId, new Set(guestIds));
    return { affected: guestIds.length };
  }

  async createInvitation(
    input: CreateInvitationRecord,
  ): Promise<Omit<InvitationCreated, "token" | "publicUrl">> {
    this.requireMember(input.createdByUserId, input.weddingId);
    const guest = this.guests.get(input.guestId);
    if (
      !guest ||
      guest.weddingId !== input.weddingId ||
      guest.detail.archivedAt
    ) {
      throw new NotFoundError("Guest not found");
    }
    const existing = [...this.invitations.values()].find(
      (invitation) =>
        invitation.weddingId === input.weddingId &&
        invitation.guestId === input.guestId &&
        !invitation.expired,
    );
    if (existing)
      throw new ConflictError("Guest already has an active invitation");
    this.invitations.set(input.id, { ...input, expired: false });
    return input.expiresAt
      ? { id: input.id, guestId: input.guestId, expiresAt: input.expiresAt }
      : { id: input.id, guestId: input.guestId };
  }

  async replaceInvitation(
    input: CreateInvitationRecord,
  ): Promise<Omit<InvitationCreated, "token" | "publicUrl">> {
    this.requireMember(input.createdByUserId, input.weddingId);
    const guest = this.requireGuest(input.weddingId, input.guestId);
    if (guest.detail.archivedAt) throw new NotFoundError("Guest not found");
    this.revokeInvitations(input.weddingId, new Set([input.guestId]));
    this.invitations.set(input.id, { ...input, expired: false });
    return input.expiresAt
      ? { id: input.id, guestId: input.guestId, expiresAt: input.expiresAt }
      : { id: input.id, guestId: input.guestId };
  }

  async findPublicInvitation(
    tokenHash: string,
  ): Promise<PublicInvitation | null> {
    const invitation = this.activeInvitation(tokenHash);
    if (!invitation) return null;
    const guest = this.guests.get(invitation.guestId);
    const wedding = this.weddings.get(invitation.weddingId);
    if (!guest || !wedding) return null;
    const weddingView = wedding.summary.weddingDate
      ? {
          name: wedding.summary.name,
          weddingDate: wedding.summary.weddingDate,
          timeZone: wedding.summary.timeZone,
          locale: wedding.summary.locale,
        }
      : {
          name: wedding.summary.name,
          timeZone: wedding.summary.timeZone,
          locale: wedding.summary.locale,
        };
    return {
      invitationId: invitation.id,
      guest: {
        name: guest.detail.name,
        allowedPartySize: guest.detail.allowedPartySize,
      },
      wedding: weddingView,
      rsvp: this.rsvpsByGuest.get(guest.detail.id) ?? null,
    };
  }

  async upsertRsvp(
    tokenHash: string,
    id: string,
    input: SubmitRsvpInput,
  ): Promise<RsvpWriteResult> {
    const invitation = this.activeInvitation(tokenHash);
    if (!invitation) return { kind: "not_found" };
    const guest = this.guests.get(invitation.guestId);
    if (!guest) return { kind: "not_found" };
    if (
      input.attendance === "attending" &&
      input.partySize > guest.detail.allowedPartySize
    ) {
      return {
        kind: "invalid_party_size",
        allowedPartySize: guest.detail.allowedPartySize,
      };
    }
    const updatedAt = this.now().toISOString();
    const response: RsvpResponse = input.note
      ? { ...input, updatedAt }
      : { attendance: input.attendance, partySize: input.partySize, updatedAt };
    void id;
    this.rsvpsByGuest.set(guest.detail.id, response);
    return { kind: "saved", value: response };
  }

  persistedInvitation(id: string): InvitationRecord | undefined {
    return this.invitations.get(id);
  }

  expireInvitation(id: string): void {
    const invitation = this.invitations.get(id);
    if (invitation) invitation.expired = true;
  }

  private requireMember(userId: string, weddingId: string): WeddingRecord {
    const wedding = this.weddings.get(weddingId);
    if (!wedding?.members.has(userId))
      throw new NotFoundError("Wedding not found");
    return wedding;
  }

  private affiliationsForWedding(weddingId: string): GuestAffiliation[] {
    return [...this.guestAffiliations.values()]
      .filter((record) => record.weddingId === weddingId)
      .map((record) => record.summary)
      .toSorted(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.createdAt.localeCompare(right.createdAt) ||
          left.id.localeCompare(right.id),
      );
  }

  private requireAffiliation(
    weddingId: string,
    affiliationId: string,
  ): { weddingId: string; summary: GuestAffiliation } {
    const record = this.guestAffiliations.get(affiliationId);
    if (!record || record.weddingId !== weddingId) {
      throw new NotFoundError("Guest affiliation not found");
    }
    return record;
  }

  private requireGuest(weddingId: string, guestId: string): GuestRecord {
    const record = this.guests.get(guestId);
    if (!record || record.weddingId !== weddingId) {
      throw new NotFoundError("Guest not found");
    }
    return record;
  }

  private revokeInvitations(weddingId: string, guestIds: Set<string>): void {
    for (const invitation of this.invitations.values()) {
      if (
        invitation.weddingId === weddingId &&
        guestIds.has(invitation.guestId)
      ) {
        invitation.expired = true;
      }
    }
  }

  private assertUniqueAffiliationName(
    weddingId: string,
    name: string,
    exceptId?: string,
  ): void {
    const duplicate = [...this.guestAffiliations.entries()].some(
      ([id, record]) =>
        id !== exceptId &&
        record.weddingId === weddingId &&
        record.summary.name.localeCompare(name, undefined, {
          sensitivity: "accent",
        }) === 0,
    );
    if (duplicate) throw new ConflictError("Guest affiliation already exists");
  }

  private activeInvitation(tokenHash: string): InvitationRecord | undefined {
    return [...this.invitations.values()].find(
      (invitation) =>
        invitation.tokenHash === tokenHash &&
        !invitation.expired &&
        (!invitation.expiresAt ||
          invitation.expiresAt > this.now().toISOString()),
    );
  }
}

function guestSummary(
  detail: GuestDetail,
  rsvpsByGuest: Map<string, RsvpResponse>,
): GuestSummary {
  const summary: GuestSummary = {
    id: detail.id,
    name: detail.name,
    allowedPartySize: detail.allowedPartySize,
    affiliation: detail.affiliation,
    createdAt: detail.createdAt,
    rsvp: rsvpsByGuest.get(detail.id) ?? null,
  };
  if (detail.email) summary.email = detail.email;
  if (detail.phone) summary.phone = detail.phone;
  if (detail.archivedAt) summary.archivedAt = detail.archivedAt;
  return summary;
}

function guestDetail(
  detail: GuestDetail,
  rsvpsByGuest: Map<string, RsvpResponse>,
): GuestDetail {
  return {
    ...detail,
    postalAddress: detail.postalAddress ? { ...detail.postalAddress } : null,
    rsvp: rsvpsByGuest.get(detail.id) ?? null,
  };
}

function applyOptional(
  detail: GuestDetail,
  key: "email" | "phone" | "envelopeName" | "note",
  value: string | null | undefined,
): void {
  if (value === undefined) return;
  if (value === null) {
    delete detail[key];
    return;
  }
  detail[key] = value;
}

function matchesGuestFilters(
  detail: GuestDetail,
  input: GuestListRepositoryInput,
  rsvpsByGuest: Map<string, RsvpResponse>,
): boolean {
  const search = input.search?.toLocaleLowerCase();
  if (
    search &&
    ![detail.name, detail.email, detail.phone].some((field) =>
      field?.toLocaleLowerCase().startsWith(search),
    )
  ) {
    return false;
  }
  if (input.affiliation === "unassigned" && detail.affiliation !== null) {
    return false;
  }
  if (
    input.affiliation &&
    input.affiliation !== "unassigned" &&
    detail.affiliation?.id !== input.affiliation
  ) {
    return false;
  }
  const rsvp = rsvpsByGuest.get(detail.id);
  if (input.rsvp === "pending" && rsvp) return false;
  if (input.rsvp === "attending" && rsvp?.attendance !== "attending") {
    return false;
  }
  if (input.rsvp === "declined" && rsvp?.attendance !== "declined") {
    return false;
  }
  return true;
}

function paginate<T extends { id: string; createdAt: string }>(
  items: T[],
  page: RepositoryPageInput,
): Page<T> {
  const ordered = items.toSorted(
    (left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      right.id.localeCompare(left.id),
  );
  const afterCursor = page.cursor
    ? ordered.filter(
        (item) =>
          item.createdAt < page.cursor!.createdAt ||
          (item.createdAt === page.cursor!.createdAt &&
            item.id < page.cursor!.id),
      )
    : ordered;
  const window = afterCursor.slice(0, page.limit + 1);
  const hasMore = window.length > page.limit;
  const pageItems = hasMore ? window.slice(0, page.limit) : window;
  const last = pageItems.at(-1);
  return {
    items: pageItems,
    nextCursor: hasMore && last ? encodeCursor(last) : null,
  };
}
