import type {
  AcceptedResponse,
  AuthenticatedUser,
  AuthSessionResponse,
  CreateGuestInput,
  CreateWeddingInput,
  ForgotPasswordInput,
  GuestSummary,
  InvitationCreated,
  Page,
  PublicInvitation,
  ResendVerificationInput,
  ResetPasswordInput,
  RsvpResponse,
  SignInInput,
  SignUpInput,
  SubmitRsvpInput,
  UpdateProfileInput,
  VerifyEmailInput,
  WeddingSummary,
} from "@lovechapter/contracts";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  static async fromResponse(response: Response): Promise<ApiError> {
    const fallback = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      return new ApiError(
        payload.error?.message ?? fallback,
        response.status,
        payload.error?.code,
      );
    } catch {
      return new ApiError(fallback, response.status);
    }
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("API paths must be root-relative");
  }
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`/api${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
  });
  if (!response.ok) throw await ApiError.fromResponse(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export type AuthenticationRequiredHandler = () => void | Promise<void>;

export function createLoveChapterApi(
  onAuthenticationRequired: AuthenticationRequiredHandler,
) {
  const request = <T>(path: string, init?: RequestInit) =>
    authenticatedRequest<T>(onAuthenticationRequired, path, init);

  return {
    signUp: (input: SignUpInput) =>
      apiRequest<AcceptedResponse>("/v1/auth/sign-up", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    resendVerificationEmail: (input: ResendVerificationInput) =>
      apiRequest<AcceptedResponse>("/v1/auth/verification-email", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    verifyEmail: (input: VerifyEmailInput) =>
      apiRequest<{ verified: true }>("/v1/auth/verify-email", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    signIn: (input: SignInInput) =>
      apiRequest<{ signedIn: true }>("/v1/auth/sign-in", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    getSession: () => request<AuthSessionResponse>("/v1/auth/session"),
    signOut: () =>
      apiRequest<void>("/v1/auth/sign-out", {
        method: "POST",
        body: "{}",
      }),
    forgotPassword: (input: ForgotPasswordInput) =>
      apiRequest<AcceptedResponse>("/v1/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    resetPassword: (input: ResetPasswordInput) =>
      apiRequest<{ reset: true }>("/v1/auth/reset-password", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    getMe: () => request<AuthenticatedUser>("/v1/me"),
    updateMyProfile: (input: UpdateProfileInput) =>
      request<AuthenticatedUser>("/v1/me", {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    listWeddings: (cursor?: string) =>
      request<Page<WeddingSummary>>(`/v1/weddings?${pageQuery(cursor)}`),
    createWedding: (input: CreateWeddingInput) =>
      request<WeddingSummary>("/v1/weddings", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    listGuests: (weddingId: string, cursor?: string) =>
      request<Page<GuestSummary>>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guests?${pageQuery(cursor)}`,
      ),
    addGuest: (weddingId: string, input: CreateGuestInput) =>
      request<GuestSummary>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guests`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    createInvitation: (weddingId: string, guestId: string) =>
      request<InvitationCreated>(
        `/v1/weddings/${encodeURIComponent(weddingId)}/guests/${encodeURIComponent(guestId)}/invitations`,
        { method: "POST", body: "{}" },
      ),
  };
}

export const loveChapterPublicApi = {
  getInvitation: (token: string) =>
    apiRequest<PublicInvitation>(
      `/v1/public/invitations/${encodeURIComponent(token)}`,
    ),
  submitRsvp: (token: string, input: SubmitRsvpInput) =>
    apiRequest<RsvpResponse>(
      `/v1/public/invitations/${encodeURIComponent(token)}/rsvp`,
      { method: "PUT", body: JSON.stringify(input) },
    ),
};

async function authenticatedRequest<T>(
  onAuthenticationRequired: AuthenticationRequiredHandler,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  try {
    return await apiRequest<T>(path, init);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await onAuthenticationRequired();
    }
    throw error;
  }
}

function pageQuery(cursor?: string): string {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor) query.set("cursor", cursor);
  return query.toString();
}
