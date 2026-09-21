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
  UpdateProfileInput,
  WeddingSummary,
} from "@lovechapter/contracts";

import { encodeCursor } from "../cursor";
import { ConflictError, NotFoundError } from "../errors";
import type { Principal } from "../identity";
import type {
  CreateInvitationRecord,
  LoveChapterRepository,
  RepositoryPageInput,
  RsvpWriteResult,
} from "../ports";

type WeddingRecord = {
  summary: WeddingSummary;
  members: Set<string>;
};

type GuestRecord = {
  weddingId: string;
  summary: GuestSummary;
};

type InvitationRecord = CreateInvitationRecord & {
  expired: boolean;
};

export class InMemoryLoveChapterRepository implements LoveChapterRepository {
  private readonly usersByIdentity = new Map<string, AuthenticatedUser>();
  private readonly weddings = new Map<string, WeddingRecord>();
  private readonly guests = new Map<string, GuestRecord>();
  private readonly invitations = new Map<string, InvitationRecord>();
  private readonly rsvpsByGuest = new Map<string, RsvpResponse>();
  private readonly now: () => Date;

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
    const onboardingComplete = principal.provider === "development";
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

  async listGuests(
    userId: string,
    weddingId: string,
    page: RepositoryPageInput,
  ): Promise<Page<GuestSummary>> {
    this.requireMember(userId, weddingId);
    const items = [...this.guests.values()]
      .filter((record) => record.weddingId === weddingId)
      .map((record) => ({
        ...record.summary,
        rsvp: this.rsvpsByGuest.get(record.summary.id) ?? null,
      }));
    return paginate(items, page);
  }

  async createGuest(
    userId: string,
    weddingId: string,
    id: string,
    input: CreateGuestInput,
  ): Promise<GuestSummary> {
    this.requireMember(userId, weddingId);
    const summary: GuestSummary = input.email
      ? {
          id,
          name: input.name,
          email: input.email,
          allowedPartySize: input.allowedPartySize,
          createdAt: this.now().toISOString(),
          rsvp: null,
        }
      : {
          id,
          name: input.name,
          allowedPartySize: input.allowedPartySize,
          createdAt: this.now().toISOString(),
          rsvp: null,
        };
    this.guests.set(id, { weddingId, summary });
    return summary;
  }

  async createInvitation(
    input: CreateInvitationRecord,
  ): Promise<Omit<InvitationCreated, "token" | "publicUrl">> {
    this.requireMember(input.createdByUserId, input.weddingId);
    const guest = this.guests.get(input.guestId);
    if (!guest || guest.weddingId !== input.weddingId) {
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
        name: guest.summary.name,
        allowedPartySize: guest.summary.allowedPartySize,
      },
      wedding: weddingView,
      rsvp: this.rsvpsByGuest.get(guest.summary.id) ?? null,
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
      input.partySize > guest.summary.allowedPartySize
    ) {
      return {
        kind: "invalid_party_size",
        allowedPartySize: guest.summary.allowedPartySize,
      };
    }
    const updatedAt = this.now().toISOString();
    const response: RsvpResponse = input.note
      ? { ...input, updatedAt }
      : { attendance: input.attendance, partySize: input.partySize, updatedAt };
    void id;
    this.rsvpsByGuest.set(guest.summary.id, response);
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
