import type {
  AuthenticatedUser,
  BulkGuestResult,
  CreateGuestAffiliationInput,
  CreateGuestInput,
  CreateWeddingInput,
  EnvelopePrintData,
  EnvelopePrintDataInput,
  EnvelopeTemplate,
  EnvelopeTemplateInput,
  GuestAffiliation,
  GuestCsvRow,
  GuestImportCommitResult,
  GuestImportMapping,
  GuestImportPreview,
  GuestDetail,
  GuestRsvpFilter,
  GuestSummary,
  GuestView,
  InvitationCreated,
  Page,
  PostalAddressInput,
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

export type GuestListRepositoryInput = RepositoryPageInput & {
  search?: string;
  affiliation?: string | "unassigned";
  rsvp?: GuestRsvpFilter;
  view: GuestView;
};

export type GuestExportPageRow = GuestCsvRow & {
  cursorCreatedAt: string;
  cursorId: string;
};

export type GuestImportSourceRow = {
  id: string;
  rowNumber: number;
  values: string[];
  included: boolean;
};
export type GuestImportStagedRow = GuestImportSourceRow & {
  candidate: CreateGuestInput | null;
  errors: string[];
  warnings: string[];
};
export type StageGuestImportInput = {
  id: string;
  userId: string;
  weddingId: string;
  sourceSha256: string;
  headers: string[];
  mapping: GuestImportMapping;
  affiliationMappings: Record<string, string>;
  rows: GuestImportStagedRow[];
  expiresAt: string;
};
export type GuestImportMappingState = {
  batchId: string;
  headers: string[];
  mapping: GuestImportMapping;
  affiliationMappings: Record<string, string>;
  mappingVersion: number;
  status: "previewed" | "committed";
  rows: GuestImportSourceRow[];
};
export type GuestImportCandidateKey = {
  rowId: string;
  normalizedEmail: string | null;
  normalizedName: string;
  normalizedPhone: string | null;
};
export type GuestImportDuplicateMatch = {
  rowId: string;
  kind: "email" | "name_phone";
};
export type ReplaceGuestImportPreviewInput = {
  userId: string;
  weddingId: string;
  batchId: string;
  expectedVersion: number;
  mapping: GuestImportMapping;
  affiliationMappings: Record<string, string>;
  rows: GuestImportStagedRow[];
};

export interface GuestImportRepository {
  stageGuestImport(input: StageGuestImportInput): Promise<GuestImportPreview>;
  getGuestImport(
    userId: string,
    weddingId: string,
    batchId: string,
    page: { limit: number; cursor?: { rowNumber: number; id: string } },
  ): Promise<GuestImportPreview>;
  loadGuestImportForMapping(
    userId: string,
    weddingId: string,
    batchId: string,
  ): Promise<GuestImportMappingState>;
  findLikelyGuestDuplicates(
    userId: string,
    weddingId: string,
    candidates: GuestImportCandidateKey[],
  ): Promise<GuestImportDuplicateMatch[]>;
  replaceGuestImportPreview(
    input: ReplaceGuestImportPreviewInput,
  ): Promise<GuestImportPreview>;
  commitGuestImport(input: {
    userId: string;
    weddingId: string;
    batchId: string;
    expectedVersion: number;
    includedRowIds: string[];
    createAnywayRowIds: string[];
    idempotencyKey: string;
  }): Promise<GuestImportCommitResult>;
  cleanupExpiredGuestImports(input: {
    now: string;
    limit: 500;
  }): Promise<number>;
}

export interface EnvelopeRepository {
  listEnvelopeTemplates(
    userId: string,
    weddingId: string,
  ): Promise<EnvelopeTemplate[]>;
  createEnvelopeTemplate(
    userId: string,
    weddingId: string,
    id: string,
    input: EnvelopeTemplateInput,
  ): Promise<EnvelopeTemplate>;
  updateEnvelopeTemplate(
    userId: string,
    weddingId: string,
    templateId: string,
    input: EnvelopeTemplateInput,
  ): Promise<EnvelopeTemplate>;
  deleteEnvelopeTemplate(
    userId: string,
    weddingId: string,
    templateId: string,
  ): Promise<void>;
  getEnvelopePrintData(
    userId: string,
    weddingId: string,
    input: EnvelopePrintDataInput,
  ): Promise<EnvelopePrintData>;
}

export type NormalizedGuestUpdate = {
  name?: string;
  email?: string | null;
  phone?: string | null;
  allowedPartySize?: number;
  affiliationId?: string | null;
  envelopeName?: string | null;
  note?: string | null;
  postalAddress?: PostalAddressInput | null;
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
    input: GuestListRepositoryInput,
  ): Promise<Page<GuestSummary>>;
  listGuestExportPage(
    userId: string,
    weddingId: string,
    input: GuestListRepositoryInput & { limit: 500 },
  ): Promise<Page<GuestExportPageRow>>;
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
  getGuest(
    userId: string,
    weddingId: string,
    guestId: string,
  ): Promise<GuestDetail>;
  updateGuest(
    userId: string,
    weddingId: string,
    guestId: string,
    input: NormalizedGuestUpdate,
  ): Promise<GuestDetail>;
  archiveGuest(
    userId: string,
    weddingId: string,
    guestId: string,
  ): Promise<GuestDetail>;
  restoreGuest(
    userId: string,
    weddingId: string,
    guestId: string,
  ): Promise<GuestDetail>;
  bulkSetGuestAffiliation(
    userId: string,
    weddingId: string,
    guestIds: string[],
    affiliationId: string | null,
  ): Promise<BulkGuestResult>;
  bulkArchiveGuests(
    userId: string,
    weddingId: string,
    guestIds: string[],
  ): Promise<BulkGuestResult>;
  createInvitation(
    input: CreateInvitationRecord,
  ): Promise<Omit<InvitationCreated, "token" | "publicUrl">>;
  replaceInvitation(
    input: CreateInvitationRecord,
  ): Promise<Omit<InvitationCreated, "token" | "publicUrl">>;
  findPublicInvitation(tokenHash: string): Promise<PublicInvitation | null>;
  upsertRsvp(
    tokenHash: string,
    id: string,
    input: SubmitRsvpInput,
  ): Promise<RsvpWriteResult>;
}
