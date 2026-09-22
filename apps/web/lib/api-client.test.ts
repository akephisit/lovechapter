import type {
  AuthenticatedUser,
  PublicInvitation,
} from "@lovechapter/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  createLoveChapterApi,
  loveChapterPublicApi,
} from "./api-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("LoveChapter API client", () => {
  it("uses same-origin cookie credentials without bearer headers", async () => {
    const clientFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({ user: userFixture() }),
    );
    vi.stubGlobal("fetch", clientFetch);

    await createLoveChapterApi(vi.fn()).getSession();

    expect(clientFetch).toHaveBeenCalledWith(
      "/api/v1/auth/session",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    const headers = new Headers(clientFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.has("authorization")).toBe(false);
  });

  it("exposes every first-party authentication endpoint", async () => {
    const clientFetch = vi.fn<typeof fetch>(async (input) => {
      const path = String(input);
      if (path.endsWith("/sign-out"))
        return new Response(null, { status: 204 });
      if (path.endsWith("/session")) {
        return jsonResponse({ user: userFixture() });
      }
      if (path.endsWith("/verify-email")) {
        return jsonResponse({ verified: true });
      }
      if (path.endsWith("/reset-password")) {
        return jsonResponse({ reset: true });
      }
      if (path.endsWith("/sign-in")) {
        return jsonResponse({ signedIn: true });
      }
      return jsonResponse({ accepted: true }, 202);
    });
    vi.stubGlobal("fetch", clientFetch);
    const api = createLoveChapterApi(vi.fn());

    await api.signUp({
      displayName: "Mali & Arun",
      email: "couple@example.test",
      password: "correct horse battery staple",
    });
    await api.resendVerificationEmail({ email: "couple@example.test" });
    await api.verifyEmail({ token: "verification-token" });
    await api.signIn({
      email: "couple@example.test",
      password: "correct horse battery staple",
    });
    await api.getSession();
    await api.signOut();
    await api.forgotPassword({ email: "couple@example.test" });
    await api.resetPassword({
      token: "reset-token",
      password: "replacement password phrase",
    });

    expect(clientFetch.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/auth/sign-up",
      "/api/v1/auth/verification-email",
      "/api/v1/auth/verify-email",
      "/api/v1/auth/sign-in",
      "/api/v1/auth/session",
      "/api/v1/auth/sign-out",
      "/api/v1/auth/forgot-password",
      "/api/v1/auth/reset-password",
    ]);
  });

  it("retains the stable error and notifies auth state once after an API 401", async () => {
    const onAuthenticationRequired = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "authentication_required",
              message: "Authentication required",
            },
          },
          401,
        ),
      ),
    );

    await expect(
      createLoveChapterApi(onAuthenticationRequired).listWeddings(),
    ).rejects.toMatchObject({
      status: 401,
      code: "authentication_required",
    });
    expect(onAuthenticationRequired).toHaveBeenCalledOnce();
  });

  it("sends JSON mutations through the same-origin route", async () => {
    const clientFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({ ...userFixture(), displayName: "คู่รัก" }),
    );
    vi.stubGlobal("fetch", clientFetch);

    await createLoveChapterApi(vi.fn()).updateMyProfile({
      displayName: "คู่รัก",
    });

    const [url, init] = clientFetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/v1/me");
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(JSON.stringify({ displayName: "คู่รัก" }));
    expect(new Headers(init?.headers).get("content-type")).toBe(
      "application/json",
    );
  });

  it("exposes wedding-scoped guest affiliation operations", async () => {
    const weddingId = "wedding/with spaces";
    const affiliationId = "affiliation/one";
    const guestId = "guest/one";
    const clientFetch = vi.fn<typeof fetch>(async (_input, init) =>
      init?.method === "DELETE"
        ? new Response(null, { status: 204 })
        : jsonResponse([]),
    );
    vi.stubGlobal("fetch", clientFetch);
    const api = createLoveChapterApi(vi.fn());

    await api.listGuestAffiliations(weddingId);
    await api.createGuestAffiliation(weddingId, {
      name: "Family",
      color: "#a855f7",
    });
    await api.updateGuestAffiliation(weddingId, affiliationId, {
      name: "Close family",
      color: "#a855f7",
    });
    await api.reorderGuestAffiliations(weddingId, [affiliationId]);
    await api.setGuestAffiliation(weddingId, guestId, { affiliationId });
    await api.deleteGuestAffiliation(weddingId, affiliationId);

    expect(
      clientFetch.mock.calls.map(([url, init]) => [url, init?.method ?? "GET"]),
    ).toEqual([
      ["/api/v1/weddings/wedding%2Fwith%20spaces/guest-affiliations", "GET"],
      ["/api/v1/weddings/wedding%2Fwith%20spaces/guest-affiliations", "POST"],
      [
        "/api/v1/weddings/wedding%2Fwith%20spaces/guest-affiliations/affiliation%2Fone",
        "PATCH",
      ],
      [
        "/api/v1/weddings/wedding%2Fwith%20spaces/guest-affiliations/order",
        "PUT",
      ],
      [
        "/api/v1/weddings/wedding%2Fwith%20spaces/guests/guest%2Fone/affiliation",
        "PATCH",
      ],
      [
        "/api/v1/weddings/wedding%2Fwith%20spaces/guest-affiliations/affiliation%2Fone",
        "DELETE",
      ],
    ]);
    expect(clientFetch.mock.calls[3]?.[1]?.body).toBe(
      JSON.stringify({ ids: [affiliationId] }),
    );
    expect(clientFetch.mock.calls[4]?.[1]?.body).toBe(
      JSON.stringify({ affiliationId }),
    );
  });

  it("keeps public invitation requests on the same-origin proxy", async () => {
    const clientFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse(invitationFixture()),
    );
    vi.stubGlobal("fetch", clientFetch);

    await loveChapterPublicApi.getInvitation("safe-token");

    expect(clientFetch.mock.calls[0]?.[0]).toBe(
      "/api/v1/public/invitations/safe-token",
    );
    const headers = new Headers(clientFetch.mock.calls[0]?.[1]?.headers);
    expect(headers.has("authorization")).toBe(false);
  });

  it("keeps stable error parsing for non-JSON failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("unavailable", { status: 503 })),
    );

    await expect(createLoveChapterApi(vi.fn()).getSession()).rejects.toEqual(
      new ApiError("Request failed (503)", 503),
    );
  });
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function userFixture(): AuthenticatedUser {
  return {
    id: "018f0000-0000-7000-8000-000000000000",
    displayName: "Couple one",
    email: "one@example.test",
    onboardingComplete: true,
  };
}

function invitationFixture(): PublicInvitation {
  return {
    invitationId: "018f0000-0000-7000-8000-000000000003",
    guest: { name: "Nok", allowedPartySize: 2 },
    wedding: {
      name: "Mali & Arun",
      weddingDate: "2027-02-14",
      timeZone: "Asia/Bangkok",
      locale: "en",
    },
    rsvp: null,
  };
}
