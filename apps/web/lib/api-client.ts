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

import { parsePublicApiOrigin } from "./public-origin";

const apiOrigin = parsePublicApiOrigin(process.env.NEXT_PUBLIC_API_ORIGIN);

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
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(new URL(path, `${apiOrigin}/`), {
    ...init,
    headers,
  });
  if (!response.ok) throw await ApiError.fromResponse(response);
  return response.json() as Promise<T>;
}

export const loveChapterApi = {
  getMe: () => apiRequest<AuthenticatedUser>("/v1/me"),
  listWeddings: (cursor?: string) =>
    apiRequest<Page<WeddingSummary>>(`/v1/weddings?${pageQuery(cursor)}`),
  createWedding: (input: CreateWeddingInput) =>
    apiRequest<WeddingSummary>("/v1/weddings", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  listGuests: (weddingId: string, cursor?: string) =>
    apiRequest<Page<GuestSummary>>(
      `/v1/weddings/${encodeURIComponent(weddingId)}/guests?${pageQuery(cursor)}`,
    ),
  addGuest: (weddingId: string, input: CreateGuestInput) =>
    apiRequest<GuestSummary>(
      `/v1/weddings/${encodeURIComponent(weddingId)}/guests`,
      { method: "POST", body: JSON.stringify(input) },
    ),
  createInvitation: (weddingId: string, guestId: string) =>
    apiRequest<InvitationCreated>(
      `/v1/weddings/${encodeURIComponent(weddingId)}/guests/${encodeURIComponent(guestId)}/invitations`,
      { method: "POST", body: "{}" },
    ),
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

function pageQuery(cursor?: string): string {
  const query = new URLSearchParams({ limit: "20" });
  if (cursor) query.set("cursor", cursor);
  return query.toString();
}
