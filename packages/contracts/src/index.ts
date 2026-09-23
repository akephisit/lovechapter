export const ATTENDANCE_VALUES = ["attending", "declined"] as const;
export type Attendance = (typeof ATTENDANCE_VALUES)[number];

export const MEMBERSHIP_ROLE_VALUES = [
  "owner",
  "couple",
  "planner",
  "collaborator",
] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLE_VALUES)[number];

export type ApiErrorResponse = {
  error: { code: string; message: string };
};

export type AuthenticatedUser = {
  id: string;
  displayName: string;
  email?: string;
  onboardingComplete: boolean;
};

export type SignUpInput = {
  displayName: string;
  email: string;
  password: string;
};

export type SignInInput = { email: string; password: string };
export type ResendVerificationInput = { email: string };
export type VerifyEmailInput = { token: string };
export type ForgotPasswordInput = { email: string };
export type ResetPasswordInput = { token: string; password: string };
export type AcceptedResponse = { accepted: true };
export type AuthSessionResponse = { user: AuthenticatedUser };

export type UpdateProfileInput = {
  displayName: string;
};

export type CreateWeddingInput = {
  name: string;
  weddingDate?: string;
  timeZone: string;
  locale: string;
};

export type WeddingSummary = CreateWeddingInput & {
  id: string;
  role: MembershipRole;
  createdAt: string;
};

export type GuestAffiliation = {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  createdAt: string;
};

export type CreateGuestAffiliationInput = {
  name: string;
  color: string;
};

export type UpdateGuestAffiliationInput = CreateGuestAffiliationInput;

export type ReorderGuestAffiliationsInput = {
  ids: string[];
};

export type SetGuestAffiliationInput = {
  affiliationId: string | null;
};

export const GUEST_RSVP_FILTER_VALUES = [
  "pending",
  "attending",
  "declined",
] as const;
export type GuestRsvpFilter = (typeof GUEST_RSVP_FILTER_VALUES)[number];
export type GuestView = "active" | "archived";

export type PostalAddressInput = {
  addressLine1: string;
  addressLine2?: string;
  locality?: string;
  administrativeArea?: string;
  postalCode?: string;
  countryCode?: string;
};

export type CreateGuestInput = {
  name: string;
  email?: string;
  phone?: string;
  allowedPartySize: number;
  affiliationId?: string;
  envelopeName?: string;
  note?: string;
  postalAddress?: PostalAddressInput;
};

export type UpdateGuestInput = Partial<
  Omit<CreateGuestInput, "postalAddress">
> & {
  postalAddress?: PostalAddressInput | null;
};

export type GuestListInput = PageInput & {
  search?: string;
  affiliation?: string | "unassigned";
  rsvp?: GuestRsvpFilter;
  view: GuestView;
};

export type RsvpResponse = {
  attendance: Attendance;
  partySize: number;
  note?: string;
  updatedAt: string;
};

export type GuestSummary = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  allowedPartySize: number;
  affiliation: GuestAffiliation | null;
  createdAt: string;
  archivedAt?: string;
  rsvp: RsvpResponse | null;
};

export type GuestCsvRow = {
  name: string;
  email: string | null;
  phone: string | null;
  allowedPartySize: number;
  affiliation: string | null;
  envelopeName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  locality: string | null;
  administrativeArea: string | null;
  postalCode: string | null;
  countryCode: string | null;
  note: string | null;
  rsvpStatus: Attendance | null;
  rsvpPartySize: number | null;
};

export const GUEST_IMPORT_FIELDS = [
  "name",
  "email",
  "phone",
  "allowedPartySize",
  "affiliation",
  "envelopeName",
  "addressLine1",
  "addressLine2",
  "locality",
  "administrativeArea",
  "postalCode",
  "countryCode",
  "note",
] as const;
export type GuestImportField = (typeof GUEST_IMPORT_FIELDS)[number];
export type GuestImportMapping = Record<GuestImportField, number | null>;
export type GuestImportMappingInput = {
  expectedVersion: number;
  mapping: GuestImportMapping;
  affiliationMappings: Record<string, string>;
  excludedRowIds: string[];
};
export type GuestImportCommitInput = {
  expectedVersion: number;
  includedRowIds: string[];
  createAnywayRowIds: string[];
  idempotencyKey: string;
};
export type GuestImportPreviewRow = {
  id: string;
  rowNumber: number;
  sourceName: string | null;
  sourceAffiliation: string | null;
  candidate: CreateGuestInput | null;
  errors: string[];
  warnings: string[];
  included: boolean;
};
export type GuestImportTotals = {
  valid: number;
  warning: number;
  invalid: number;
  excluded: number;
};
export type GuestImportPreview = {
  batchId: string;
  headers: string[];
  mapping: GuestImportMapping;
  affiliationMappings: Record<string, string>;
  mappingVersion: number;
  status: "previewed" | "committed";
  totals: GuestImportTotals;
  items: GuestImportPreviewRow[];
  nextCursor: string | null;
};
export type GuestImportCommitResult = {
  created: number;
  excluded: number;
  guestIds: string[];
};

export const ENVELOPE_ORIENTATIONS = ["landscape", "portrait"] as const;
export const ENVELOPE_ALIGNMENTS = ["left", "center", "right"] as const;
export const ENVELOPE_FONT_FAMILIES = [
  "noto-sans-thai",
  "noto-serif-thai",
] as const;
export const ENVELOPE_PRESETS = {
  DL: { widthMm: 220, heightMm: 110 },
  C5: { widthMm: 229, heightMm: 162 },
  C6: { widthMm: 162, heightMm: 114 },
} as const;
export type EnvelopeTemplateInput = {
  name: string;
  widthMm: number;
  heightMm: number;
  orientation: (typeof ENVELOPE_ORIENTATIONS)[number];
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  alignment: (typeof ENVELOPE_ALIGNMENTS)[number];
  fontFamily: (typeof ENVELOPE_FONT_FAMILIES)[number];
  fontSizePt: number;
  lineSpacingPercent: number;
  showAddress: boolean;
};
export type EnvelopeTemplate = EnvelopeTemplateInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};
export type EnvelopePrintGuest = {
  id: string;
  envelopeName: string;
  postalAddress: PostalAddressInput | null;
};
export type EnvelopePrintDataInput = {
  guestIds: string[];
  templateId?: string;
  template?: EnvelopeTemplateInput;
};
export type EnvelopePrintData = {
  template: EnvelopeTemplateInput;
  guests: EnvelopePrintGuest[];
};

export type GuestDetail = GuestSummary & {
  envelopeName?: string;
  note?: string;
  postalAddress: PostalAddressInput | null;
  updatedAt: string;
};

export type BulkGuestAffiliationInput = {
  guestIds: string[];
  affiliationId: string | null;
};
export type BulkGuestIdsInput = { guestIds: string[] };
export type BulkGuestResult = { affected: number };

export type InvitationCreated = {
  id: string;
  guestId: string;
  token: string;
  publicUrl: string;
  expiresAt?: string;
};

export type PublicInvitation = {
  invitationId: string;
  guest: {
    name: string;
    allowedPartySize: number;
  };
  wedding: {
    name: string;
    weddingDate?: string;
    timeZone: string;
    locale: string;
  };
  rsvp: RsvpResponse | null;
};

export type SubmitRsvpInput = {
  attendance: Attendance;
  partySize: number;
  note?: string;
};

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

export type PageInput = {
  limit: number;
  cursor?: string;
};
