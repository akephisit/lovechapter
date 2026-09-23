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
  it("calls scoped envelope template CRUD and print-data endpoints", async () => {
    const clientFetch = vi.fn<typeof fetch>(async (_url, init) =>
      init?.method === "DELETE"
        ? new Response(null, { status: 204 })
        : jsonResponse([]),
    );
    vi.stubGlobal("fetch", clientFetch);
    const api = createLoveChapterApi(vi.fn());
    const template = {
      name: "DL",
      widthMm: 220,
      heightMm: 110,
      orientation: "landscape" as const,
      marginTopMm: 10,
      marginRightMm: 10,
      marginBottomMm: 10,
      marginLeftMm: 10,
      alignment: "center" as const,
      fontFamily: "noto-sans-thai" as const,
      fontSizePt: 18,
      lineSpacingPercent: 120,
      showAddress: false,
    };
    await api.listEnvelopeTemplates("wed");
    await api.createEnvelopeTemplate("wed", template);
    await api.updateEnvelopeTemplate("wed", "id", template);
    await api.deleteEnvelopeTemplate("wed", "id");
    await api.getEnvelopePrintData("wed", { guestIds: ["guest"], template });
    expect(
      clientFetch.mock.calls.map(([url, init]) => [url, init?.method ?? "GET"]),
    ).toEqual([
      ["/api/v1/weddings/wed/envelope-templates", "GET"],
      ["/api/v1/weddings/wed/envelope-templates", "POST"],
      ["/api/v1/weddings/wed/envelope-templates/id", "PATCH"],
      ["/api/v1/weddings/wed/envelope-templates/id", "DELETE"],
      ["/api/v1/weddings/wed/envelope-print-data", "POST"],
    ]);
    expect(clientFetch.mock.calls[4]?.[1]?.body).toBe(
      JSON.stringify({ guestIds: ["guest"], template }),
    );
  });
  it("uploads raw CSV and preserves versioned mapping and commit payloads", async () => {
    const clientFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({ batchId: "batch", items: [] }),
    );
    vi.stubGlobal("fetch", clientFetch);
    const api = createLoveChapterApi(vi.fn());
    const file = new File(["name\nNok"], "guests.csv", { type: "text/csv" });
    await api.uploadGuestCsv("wedding", file);
    await api.getGuestImportPreview("wedding", "batch", "cursor");
    const mapping = { name: 0 } as Parameters<
      typeof api.updateGuestImportMapping
    >[2]["mapping"];
    await api.updateGuestImportMapping("wedding", "batch", {
      expectedVersion: 1,
      mapping,
      affiliationMappings: {},
      excludedRowIds: [],
    });
    await api.commitGuestImport("wedding", "batch", {
      expectedVersion: 2,
      includedRowIds: ["row"],
      createAnywayRowIds: [],
      idempotencyKey: "stable",
    });
    expect(clientFetch.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "POST",
        body: file,
        credentials: "same-origin",
      }),
    );
    expect(
      new Headers(clientFetch.mock.calls[0]?.[1]?.headers).get("content-type"),
    ).toBe("text/csv");
    expect(clientFetch.mock.calls[1]?.[0]).toContain("limit=100&cursor=cursor");
    expect(clientFetch.mock.calls[2]?.[1]?.body).toBe(
      JSON.stringify({
        expectedVersion: 1,
        mapping,
        affiliationMappings: {},
        excludedRowIds: [],
      }),
    );
    expect(clientFetch.mock.calls[3]?.[1]?.body).toBe(
      JSON.stringify({
        expectedVersion: 2,
        includedRowIds: ["row"],
        createAnywayRowIds: [],
        idempotencyKey: "stable",
      }),
    );
  });
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

  it("serializes guest filters and exposes every guest management mutation", async () => {
    const weddingId = "wedding/one";
    const guestId = "guest/one";
    const clientFetch = vi.fn<typeof fetch>(async () =>
      jsonResponse({ items: [], nextCursor: null }),
    );
    vi.stubGlobal("fetch", clientFetch);
    const api = createLoveChapterApi(vi.fn());

    await api.listGuests(weddingId, {
      limit: 20,
      view: "active",
      search: "สมชาย & family",
      affiliation: "unassigned",
      rsvp: "pending",
    });
    await api.getGuest(weddingId, guestId);
    await api.updateGuest(weddingId, guestId, { phone: "123" });
    await api.archiveGuest(weddingId, guestId);
    await api.restoreGuest(weddingId, guestId);
    await api.bulkSetGuestAffiliation(weddingId, {
      guestIds: [guestId],
      affiliationId: null,
    });
    await api.bulkArchiveGuests(weddingId, { guestIds: [guestId] });

    const urls = clientFetch.mock.calls.map(([url]) => String(url));
    const listUrl = new URL(urls[0]!, "https://web.example.test");
    expect(listUrl.pathname).toBe("/api/v1/weddings/wedding%2Fone/guests");
    expect(Object.fromEntries(listUrl.searchParams)).toEqual({
      limit: "20",
      view: "active",
      search: "สมชาย & family",
      affiliation: "unassigned",
      rsvp: "pending",
    });
    expect(
      clientFetch.mock.calls
        .slice(1)
        .map(([url, init]) => [url, init?.method ?? "GET"]),
    ).toEqual([
      ["/api/v1/weddings/wedding%2Fone/guests/guest%2Fone", "GET"],
      ["/api/v1/weddings/wedding%2Fone/guests/guest%2Fone", "PATCH"],
      ["/api/v1/weddings/wedding%2Fone/guests/guest%2Fone/archive", "POST"],
      ["/api/v1/weddings/wedding%2Fone/guests/guest%2Fone/restore", "POST"],
      ["/api/v1/weddings/wedding%2Fone/guests/bulk-affiliation", "PATCH"],
      ["/api/v1/weddings/wedding%2Fone/guests/bulk-archive", "POST"],
    ]);
  });

  it("downloads a filtered CSV blob with a safe filename and revokes the object URL", async () => {
    const clientFetch = vi.fn<typeof fetch>(
      async () =>
        new Response("\uFEFFname\r\n", {
          headers: {
            "content-disposition":
              'attachment; filename="lovechapter-guests.csv"',
          },
        }),
    );
    vi.stubGlobal("fetch", clientFetch);
    const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal("document", { createElement: vi.fn(() => anchor) });
    const createObjectURL = vi
      .spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:guest-csv");
    const revokeObjectURL = vi
      .spyOn(URL, "revokeObjectURL")
      .mockImplementation(() => {});

    await createLoveChapterApi(vi.fn()).downloadGuestCsv("wedding/one", {
      view: "archived",
      search: "สมชาย",
      affiliation: "unassigned",
      rsvp: "pending",
    });
    const url = new URL(
      String(clientFetch.mock.calls[0]?.[0]),
      "https://web.example.test",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      view: "archived",
      search: "สมชาย",
      affiliation: "unassigned",
      rsvp: "pending",
    });
    expect(anchor.download).toBe("lovechapter-guests.csv");
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:guest-csv");
    vi.restoreAllMocks();
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
