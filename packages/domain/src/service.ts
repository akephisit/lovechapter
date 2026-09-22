import type {
  AuthenticatedUser,
  CreateGuestAffiliationInput,
  CreateGuestInput,
  CreateWeddingInput,
  GuestAffiliation,
  GuestSummary,
  InvitationCreated,
  Page,
  PageInput,
  PublicInvitation,
  RsvpResponse,
  SubmitRsvpInput,
  UpdateGuestAffiliationInput,
  UpdateProfileInput,
  WeddingSummary,
} from "@lovechapter/contracts";

import { decodeCursor } from "./cursor";
import {
  AuthenticationRequiredError,
  DomainValidationError,
  NotFoundError,
  OnboardingRequiredError,
} from "./errors";
import type { IdentityProvider } from "./identity";
import { generateInvitationToken, hashInvitationToken } from "./invitations";
import type { LoveChapterRepository, RepositoryPageInput } from "./ports";
import { validateRsvp } from "./rsvp";

export class LoveChapterService {
  private readonly publicWebOrigin: string;

  constructor(
    private readonly identity: IdentityProvider,
    private readonly repository: LoveChapterRepository,
    publicWebOrigin: string,
    private readonly request?: Request,
  ) {
    this.publicWebOrigin = publicWebOrigin.replace(/\/$/, "");
  }

  async getMe(): Promise<AuthenticatedUser> {
    return this.requireUser();
  }

  async updateMyProfile(input: UpdateProfileInput): Promise<AuthenticatedUser> {
    const user = await this.requireUser();
    const displayName = input.displayName.trim();
    if (!displayName || Array.from(displayName).length > 120) {
      throw new DomainValidationError("Display name must be 1–120 characters");
    }
    return this.repository.updateUserProfile(user.id, { displayName });
  }

  async createWedding(input: CreateWeddingInput): Promise<WeddingSummary> {
    const user = await this.requireOnboardedUser();
    return this.repository.createWedding(
      user.id,
      crypto.randomUUID(),
      normalizeWedding(input),
    );
  }

  async listWeddings(page: PageInput): Promise<Page<WeddingSummary>> {
    const user = await this.requireOnboardedUser();
    return this.repository.listWeddings(user.id, normalizePage(page));
  }

  async listGuestAffiliations(weddingId: string): Promise<GuestAffiliation[]> {
    const user = await this.requireOnboardedUser();
    return this.repository.listGuestAffiliations(user.id, weddingId);
  }

  async createGuestAffiliation(
    weddingId: string,
    input: CreateGuestAffiliationInput,
  ): Promise<GuestAffiliation> {
    const user = await this.requireOnboardedUser();
    return this.repository.createGuestAffiliation(
      user.id,
      weddingId,
      crypto.randomUUID(),
      normalizeGuestAffiliation(input),
    );
  }

  async updateGuestAffiliation(
    weddingId: string,
    affiliationId: string,
    input: UpdateGuestAffiliationInput,
  ): Promise<GuestAffiliation> {
    const user = await this.requireOnboardedUser();
    return this.repository.updateGuestAffiliation(
      user.id,
      weddingId,
      affiliationId,
      normalizeGuestAffiliation(input),
    );
  }

  async reorderGuestAffiliations(
    weddingId: string,
    affiliationIds: string[],
  ): Promise<GuestAffiliation[]> {
    const user = await this.requireOnboardedUser();
    if (
      affiliationIds.length > 100 ||
      new Set(affiliationIds).size !== affiliationIds.length
    ) {
      throw new DomainValidationError("Invalid guest affiliation order");
    }
    return this.repository.reorderGuestAffiliations(
      user.id,
      weddingId,
      affiliationIds,
    );
  }

  async deleteGuestAffiliation(
    weddingId: string,
    affiliationId: string,
  ): Promise<void> {
    const user = await this.requireOnboardedUser();
    await this.repository.deleteGuestAffiliation(
      user.id,
      weddingId,
      affiliationId,
    );
  }

  async addGuest(
    weddingId: string,
    input: CreateGuestInput,
  ): Promise<GuestSummary> {
    const user = await this.requireOnboardedUser();
    return this.repository.createGuest(
      user.id,
      weddingId,
      crypto.randomUUID(),
      normalizeGuest(input),
    );
  }

  async setGuestAffiliation(
    weddingId: string,
    guestId: string,
    affiliationId: string | null,
  ): Promise<GuestSummary> {
    const user = await this.requireOnboardedUser();
    return this.repository.setGuestAffiliation(
      user.id,
      weddingId,
      guestId,
      affiliationId,
    );
  }

  async listGuests(
    weddingId: string,
    page: PageInput,
  ): Promise<Page<GuestSummary>> {
    const user = await this.requireOnboardedUser();
    return this.repository.listGuests(user.id, weddingId, normalizePage(page));
  }

  async createInvitation(
    weddingId: string,
    guestId: string,
  ): Promise<InvitationCreated> {
    const user = await this.requireOnboardedUser();
    const token = generateInvitationToken();
    const created = await this.repository.createInvitation({
      id: crypto.randomUUID(),
      weddingId,
      guestId,
      createdByUserId: user.id,
      tokenHash: await hashInvitationToken(token),
    });
    return {
      ...created,
      token,
      publicUrl: `${this.publicWebOrigin}/i/${token}`,
    };
  }

  async getPublicInvitation(token: string): Promise<PublicInvitation> {
    assertTokenShape(token);
    const invitation = await this.repository.findPublicInvitation(
      await hashInvitationToken(token),
    );
    if (!invitation) throw new NotFoundError("Invitation not found");
    return invitation;
  }

  async submitRsvp(
    token: string,
    input: SubmitRsvpInput,
  ): Promise<RsvpResponse> {
    assertTokenShape(token);
    const normalized = validateRsvp(input, Number.MAX_SAFE_INTEGER);
    const result = await this.repository.upsertRsvp(
      await hashInvitationToken(token),
      crypto.randomUUID(),
      normalized,
    );
    if (result.kind === "not_found") {
      throw new NotFoundError("Invitation not found");
    }
    if (result.kind === "invalid_party_size") {
      validateRsvp(normalized, result.allowedPartySize);
      throw new DomainValidationError("Invalid RSVP");
    }
    return result.value;
  }

  private async requireUser(): Promise<AuthenticatedUser> {
    const principal = await this.identity.resolve(this.request);
    if (!principal) {
      throw new AuthenticationRequiredError("Authentication required");
    }
    return this.repository.syncUser(principal);
  }

  private async requireOnboardedUser(): Promise<AuthenticatedUser> {
    const user = await this.requireUser();
    if (!user.onboardingComplete) {
      throw new OnboardingRequiredError("Profile setup required");
    }
    return user;
  }
}

function normalizePage(page: PageInput): RepositoryPageInput {
  if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > 100) {
    throw new DomainValidationError("Limit must be between 1 and 100");
  }
  return page.cursor
    ? { limit: page.limit, cursor: decodeCursor(page.cursor) }
    : { limit: page.limit };
}

function normalizeWedding(input: CreateWeddingInput): CreateWeddingInput {
  const name = input.name.trim();
  if (!name || name.length > 120) {
    throw new DomainValidationError("Wedding name must be 1–120 characters");
  }
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.timeZone });
    new Intl.Locale(input.locale);
  } catch {
    throw new DomainValidationError("Invalid locale or time zone");
  }
  if (input.weddingDate && !isIsoDate(input.weddingDate)) {
    throw new DomainValidationError("Wedding date must use YYYY-MM-DD");
  }
  return input.weddingDate
    ? {
        name,
        weddingDate: input.weddingDate,
        timeZone: input.timeZone,
        locale: input.locale,
      }
    : { name, timeZone: input.timeZone, locale: input.locale };
}

function normalizeGuest(input: CreateGuestInput): CreateGuestInput {
  const name = input.name.trim();
  if (!name || name.length > 120) {
    throw new DomainValidationError("Guest name must be 1–120 characters");
  }
  if (
    !Number.isInteger(input.allowedPartySize) ||
    input.allowedPartySize < 1 ||
    input.allowedPartySize > 20
  ) {
    throw new DomainValidationError("Party allowance must be between 1 and 20");
  }
  const email = input.email?.trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new DomainValidationError("Invalid guest email");
  }
  const affiliation = input.affiliationId
    ? { affiliationId: input.affiliationId }
    : {};
  return email
    ? { name, email, allowedPartySize: input.allowedPartySize, ...affiliation }
    : { name, allowedPartySize: input.allowedPartySize, ...affiliation };
}

function normalizeGuestAffiliation(
  input: CreateGuestAffiliationInput,
): CreateGuestAffiliationInput {
  const name = input.name.trim();
  if (!name || Array.from(name).length > 80) {
    throw new DomainValidationError(
      "Guest affiliation name must be 1–80 characters",
    );
  }
  const color = input.color.toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(color)) {
    throw new DomainValidationError("Guest affiliation color is invalid");
  }
  return { name, color };
}

function assertTokenShape(token: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    throw new NotFoundError("Invitation not found");
  }
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}
