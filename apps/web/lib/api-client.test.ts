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
  it("adds the Clerk bearer token to protected requests", async () => {
    const getToken = vi.fn(async () => "session-token");
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(userFixture()),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createLoveChapterApi(getToken, vi.fn()).getMe();

    expect(getToken).toHaveBeenCalledOnce();
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer session-token");
  });

  it("does not fetch a protected endpoint without a session token", async () => {
    const fetchMock = vi.fn();
    const onAuthenticationRequired = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createLoveChapterApi(async () => null, onAuthenticationRequired).getMe(),
    ).rejects.toEqual(
      new ApiError("Authentication required", 401, "authentication_required"),
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onAuthenticationRequired).toHaveBeenCalledOnce();
  });

  it("retains the stable error and notifies auth state after an API 401", async () => {
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
      createLoveChapterApi(
        async () => "expired-token",
        onAuthenticationRequired,
      ).listWeddings(),
    ).rejects.toMatchObject({
      status: 401,
      code: "authentication_required",
    });
    expect(onAuthenticationRequired).toHaveBeenCalledOnce();
  });

  it("sends profile completion as a protected PATCH request", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse({ ...userFixture(), displayName: "คู่รัก" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await createLoveChapterApi(
      async () => "session-token",
      vi.fn(),
    ).updateMyProfile({ displayName: "คู่รัก" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBeInstanceOf(URL);
    expect((url as URL).pathname).toBe("/v1/me");
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(JSON.stringify({ displayName: "คู่รัก" }));
  });

  it("keeps public invitation requests free of authorization headers", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      jsonResponse(invitationFixture()),
    );
    vi.stubGlobal("fetch", fetchMock);

    await loveChapterPublicApi.getInvitation("safe-token");

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.has("authorization")).toBe(false);
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
