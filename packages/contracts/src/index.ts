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

export type CreateGuestInput = {
  name: string;
  email?: string;
  allowedPartySize: number;
  affiliationId?: string;
};

export type RsvpResponse = {
  attendance: Attendance;
  partySize: number;
  note?: string;
  updatedAt: string;
};

export type GuestSummary = Omit<CreateGuestInput, "affiliationId"> & {
  id: string;
  affiliation: GuestAffiliation | null;
  createdAt: string;
  rsvp: RsvpResponse | null;
};

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
