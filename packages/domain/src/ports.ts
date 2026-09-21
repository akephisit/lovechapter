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
  listWeddings(
    userId: string,
    page: RepositoryPageInput,
  ): Promise<Page<WeddingSummary>>;
  createWedding(
    userId: string,
    id: string,
    input: CreateWeddingInput,
  ): Promise<WeddingSummary>;
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
