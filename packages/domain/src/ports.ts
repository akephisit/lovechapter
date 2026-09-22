import type {
  AuthenticatedUser,
  CreateGuestAffiliationInput,
  CreateGuestInput,
  CreateWeddingInput,
  GuestAffiliation,
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

import type { ListCursor } from "./cursor";
import type { Principal } from "./identity";

export type RepositoryPageInput = {
  limit: number;
  cursor?: ListCursor;
};

export type CreateInvitationRecord = {
  id: string;
  weddingId: string;
  guestId: string;
  createdByUserId: string;
  tokenHash: string;
  expiresAt?: string;
};

export type RsvpWriteResult =
  | { kind: "saved"; value: RsvpResponse }
  | { kind: "invalid_party_size"; allowedPartySize: number }
  | { kind: "not_found" };

export interface LoveChapterRepository {
  syncUser(principal: Principal): Promise<AuthenticatedUser>;
  updateUserProfile(
    userId: string,
    input: UpdateProfileInput,
  ): Promise<AuthenticatedUser>;
  listWeddings(
    userId: string,
    page: RepositoryPageInput,
  ): Promise<Page<WeddingSummary>>;
  createWedding(
    userId: string,
    id: string,
    input: CreateWeddingInput,
  ): Promise<WeddingSummary>;
  listGuestAffiliations(
    userId: string,
    weddingId: string,
  ): Promise<GuestAffiliation[]>;
  createGuestAffiliation(
    userId: string,
    weddingId: string,
    id: string,
    input: CreateGuestAffiliationInput,
  ): Promise<GuestAffiliation>;
  updateGuestAffiliation(
    userId: string,
    weddingId: string,
    affiliationId: string,
    input: UpdateGuestAffiliationInput,
  ): Promise<GuestAffiliation>;
  reorderGuestAffiliations(
    userId: string,
    weddingId: string,
    affiliationIds: string[],
  ): Promise<GuestAffiliation[]>;
  deleteGuestAffiliation(
    userId: string,
    weddingId: string,
    affiliationId: string,
  ): Promise<void>;
  listGuests(
    userId: string,
    weddingId: string,
    page: RepositoryPageInput,
  ): Promise<Page<GuestSummary>>;
  createGuest(
    userId: string,
    weddingId: string,
    id: string,
    input: CreateGuestInput,
  ): Promise<GuestSummary>;
  setGuestAffiliation(
    userId: string,
    weddingId: string,
    guestId: string,
    affiliationId: string | null,
  ): Promise<GuestSummary>;
  createInvitation(
    input: CreateInvitationRecord,
  ): Promise<Omit<InvitationCreated, "token" | "publicUrl">>;
  findPublicInvitation(tokenHash: string): Promise<PublicInvitation | null>;
  upsertRsvp(
    tokenHash: string,
    id: string,
    input: SubmitRsvpInput,
  ): Promise<RsvpWriteResult>;
}
