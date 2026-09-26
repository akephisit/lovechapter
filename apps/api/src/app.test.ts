import {
  AuthService,
  createActionTokenCodec,
  type PasswordHasher,
} from "@lovechapter/auth";
import { InMemoryAuthRepository } from "@lovechapter/auth/testing";
import {
  createConfiguredIdentityProvider,
  type IdentityProvider,
  LoveChapterService,
  type Principal,
  type WeddingOperationsRepository,
} from "@lovechapter/domain";
import {
  InMemoryGuestImportRepository,
  InMemoryEnvelopeRepository,
  InMemoryPlanningRepository,
  InMemoryLoveChapterRepository,
} from "@lovechapter/domain/testing";
import { describe, expect, it, vi } from "vitest";

import { createApiIdentityProvider } from "./api-identity";
import { createApiApp } from "./app";
import {
  CLIENT_ADDRESS_HEADER,
  PROXY_CREDENTIAL_HEADER,
} from "./request-security";

const apiOrigin = "https://api.example.test";
const webOrigin = "https://web.example.test";
const proxyCredential = "proxy-credential-that-is-at-least-32-bytes";
const fingerprintKey = new Uint8Array(32).fill(7);
const password = "correct horse battery staple";

describe("LoveChapter API", () => {
  it("passes authenticated budget, vendor, schedule, and seating writes through the service", async () => {
    const operations = {
      setBudget: vi.fn(
        async (_userId: string, _weddingId: string, input: unknown) => input,
      ),
      saveVendor: vi.fn(
        async (
          _userId: string,
          _weddingId: string,
          id: string,
          input: unknown,
        ) => ({ id, ...(input as object) }),
      ),
      saveRunSheetItem: vi.fn(
        async (
          _userId: string,
          _weddingId: string,
          id: string,
          input: unknown,
        ) => ({ id, ...(input as object) }),
      ),
      saveSeatingTable: vi.fn(
        async (
          _userId: string,
          _weddingId: string,
          id: string,
          input: unknown,
        ) => ({ id, ...(input as object), reserved: 0 }),
      ),
      assignSeating: vi.fn(async () => {}),
    } as unknown as WeddingOperationsRepository;
    const fixture = testFixture({
      principal: couple("operations-owner"),
      operationsRepository: operations,
    });
    const createdWedding = await fixture.app.handle(
      jsonRequest("/v1/weddings", "POST", {
        name: "Event",
        timeZone: "UTC",
        locale: "en",
      }),
    );
    const weddingId = ((await createdWedding.json()) as { id: string }).id;
    const budget = await fixture.app.handle(
      jsonRequest(`/v1/weddings/${weddingId}/budget`, "PUT", {
        currency: "thb",
        targetMinor: 100000,
      }),
    );
    expect(budget.status).toBe(200);
    expect(await budget.json()).toMatchObject({
      currency: "THB",
      targetMinor: 100000,
    });
    const vendor = await fixture.app.handle(
      jsonRequest(`/v1/weddings/${weddingId}/vendors`, "POST", {
        name: "Studio",
        status: "booked",
        quoteMinor: 1200,
      }),
    );
    expect(vendor.status).toBe(201);
    const schedule = await fixture.app.handle(
      jsonRequest(`/v1/weddings/${weddingId}/run-sheet`, "POST", {
        title: "Ceremony",
        startsAt: "2026-12-19T02:00:00Z",
        endsAt: "2026-12-19T03:00:00Z",
      }),
    );
    expect(schedule.status).toBe(201);
    expect(await schedule.json()).toMatchObject({
      startsAt: "2026-12-19T02:00:00.000Z",
    });
    const table = await fixture.app.handle(
      jsonRequest(`/v1/weddings/${weddingId}/seating/tables`, "POST", {
        name: "A",
        capacity: 8,
      }),
    );
    expect(table.status).toBe(201);
    const assignment = await fixture.app.handle(
      jsonRequest(
        `/v1/weddings/${weddingId}/seating/guests/${crypto.randomUUID()}`,
        "PUT",
        { tableId: null },
      ),
    );
    expect(assignment.status).toBe(204);
    expect(vi.mocked(operations.assignSeating)).toHaveBeenCalledWith(
      expect.any(String),
      weddingId,
      expect.any(String),
      null,
    );
  });
  it("validates wedding operations bodies and requires an authenticated member", async () => {
    const fixture = testFixture();
    const weddingId = crypto.randomUUID();
    for (const [path, body] of [
      ["budget", { currency: "USD", targetMinor: -1 }],
      ["vendors", { name: "Supplier", status: "unknown" }],
      ["expenses", { title: "Venue", plannedMinor: -1, paidMinor: 0 }],
      [
        "run-sheet",
        { title: "Ceremony", startsAt: "tomorrow", endsAt: "later" },
      ],
      ["seating/tables", { name: "A", capacity: 0 }],
    ] as const) {
      const response = await fixture.app.handle(
        jsonRequest(
          `/v1/weddings/${weddingId}/${path}`,
          path === "budget" ? "PUT" : "POST",
          body,
        ),
      );
      expect(response.status).toBe(400);
    }
    const protectedResponse = await fixture.app.handle(
      trustedRequest(`/v1/weddings/${weddingId}/budget`),
    );
    expect(protectedResponse.status).toBe(401);
  });
  it("creates, lists, completes and removes a planning task within its wedding", async () => {
    const fixture = testFixture({ principal: couple("planning-owner") });
    const createWedding = async (name: string) => {
      const response = await fixture.app.handle(
        jsonRequest("/v1/weddings", "POST", {
          name,
          timeZone: "UTC",
          locale: "en",
        }),
      );
      return (await response.json()) as { id: string };
    };
    const wedding = await createWedding("First");
    const other = await createWedding("Second");
    const path = `/v1/weddings/${wedding.id}/planning-tasks`;
    const invalid = await fixture.app.handle(
      jsonRequest(path, "POST", { title: "Bad", dueDate: "2026-02-30" }),
    );
    expect(invalid.status).toBe(400);
    const created = await fixture.app.handle(
      jsonRequest(path, "POST", { title: "Book venue", dueDate: "2026-12-01" }),
    );
    expect(created.status).toBe(201);
    const saved = (await created.json()) as {
      id: string;
      completedAt: string | null;
    };
    expect(saved.completedAt).toBeNull();
    const list = await fixture.app.handle(
      trustedRequest(`${path}?limit=1&filter=open`),
    );
    expect(await list.json()).toMatchObject({
      items: [{ id: saved.id }],
      nextCursor: null,
    });
    const denied = await fixture.app.handle(
      jsonRequest(
        `/v1/weddings/${other.id}/planning-tasks/${saved.id}`,
        "PATCH",
        { completed: true },
      ),
    );
    expect(denied.status).toBe(404);
    const changed = await fixture.app.handle(
      jsonRequest(`${path}/${saved.id}`, "PATCH", { completed: true }),
    );
    expect(changed.status).toBe(200);
    expect((await changed.json()) as { completedAt: string }).toHaveProperty(
      "completedAt",
      expect.any(String),
    );
    const overview = await fixture.app.handle(
      trustedRequest(`/v1/weddings/${wedding.id}/planning-overview`),
    );
    expect(await overview.json()).toMatchObject({
      total: 1,
      completed: 1,
      upcoming: [],
    });
    const removed = await fixture.app.handle(
      jsonRequest(`${path}/${saved.id}`, "DELETE", {}),
    );
    expect(removed.status).toBe(204);
    const missing = await fixture.app.handle(
      jsonRequest(`${path}/${saved.id}`, "PATCH", { completed: false }),
    );
    expect(missing.status).toBe(404);
  });
  it("rejects unauthenticated CSV upload before reading its bytes", async () => {
    const fixture = testFixture();
    const request = trustedRequest(
      `/v1/weddings/${crypto.randomUUID()}/guest-imports`,
      {
        method: "POST",
        origin: webOrigin,
        "content-type": "text/csv",
        body: "name\nNok",
      },
    );
    const read = vi.spyOn(request, "arrayBuffer");
    const response = await fixture.app.handle(request);
    expect(response.status).toBe(401);
    expect(read).not.toHaveBeenCalled();
  });
  it("saves scoped print templates and returns name-only data without addresses", async () => {
    const fixture = testFixture({ principal: couple("envelope-owner") });
    const weddingResponse = await fixture.app.handle(
      jsonRequest("/v1/weddings", "POST", {
        name: "Print",
        timeZone: "UTC",
        locale: "en",
      }),
    );
    const wedding = (await weddingResponse.json()) as { id: string };
    const guestResponse = await fixture.app.handle(
      jsonRequest(`/v1/weddings/${wedding.id}/guests`, "POST", {
        name: "Nok",
        allowedPartySize: 1,
      }),
    );
    const guest = (await guestResponse.json()) as { id: string };
    const template = {
      name: "DL",
      widthMm: 220,
      heightMm: 110,
      orientation: "landscape",
      marginTopMm: 10,
      marginRightMm: 10,
      marginBottomMm: 10,
      marginLeftMm: 10,
      alignment: "center",
      fontFamily: "noto-sans-thai",
      fontSizePt: 18,
      lineSpacingPercent: 120,
      showAddress: false,
    };
    const created = await fixture.app.handle(
      jsonRequest(
        `/v1/weddings/${wedding.id}/envelope-templates`,
        "POST",
        template,
      ),
    );
    expect(created.status).toBe(201);
    const saved = (await created.json()) as { id: string };
    const list = await fixture.app.handle(
      trustedRequest(`/v1/weddings/${wedding.id}/envelope-templates`),
    );
    expect(await list.json()).toEqual([
      expect.objectContaining({ id: saved.id }),
    ]);
    const printed = await fixture.app.handle(
      jsonRequest(`/v1/weddings/${wedding.id}/envelope-print-data`, "POST", {
        guestIds: [guest.id],
        templateId: saved.id,
      }),
    );
    expect(printed.status).toBe(200);
    expect(await printed.json()).toMatchObject({
      guests: [{ id: guest.id, envelopeName: "Nok", postalAddress: null }],
    });
    const bad = await fixture.app.handle(
      jsonRequest(`/v1/weddings/${wedding.id}/envelope-print-data`, "POST", {
        guestIds: [guest.id],
        templateId: saved.id,
        template,
      }),
    );
    expect(bad.status).toBe(400);
    const deleted = await fixture.app.handle(
      jsonRequest(
        `/v1/weddings/${wedding.id}/envelope-templates/${saved.id}`,
        "DELETE",
        {},
      ),
    );
    expect(deleted.status).toBe(204);
  });
  it("uploads, previews and remaps a bounded guest CSV with version checks", async () => {
    const fixture = testFixture({ principal: couple("import-owner") });
    const weddingResponse = await fixture.app.handle(
      jsonRequest("/v1/weddings", "POST", {
        name: "CSV wedding",
        timeZone: "UTC",
        locale: "en",
      }),
    );
    const wedding = (await weddingResponse.json()) as { id: string };
    const upload = await fixture.app.handle(
      trustedRequest(`/v1/weddings/${wedding.id}/guest-imports`, {
        method: "POST",
        origin: webOrigin,
        "content-type": "text/csv",
        body: "name,affiliation\nNok,unknown\nDao,\n",
      }),
    );
    expect(upload.status).toBe(201);
    const preview = (await upload.json()) as {
      batchId: string;
      mappingVersion: number;
      mapping: Record<string, number | null>;
      items: Array<{ id: string }>;
      totals: { invalid: number };
    };
    expect(preview.totals.invalid).toBe(1);
    const get = await fixture.app.handle(
      trustedRequest(
        `/v1/weddings/${wedding.id}/guest-imports/${preview.batchId}`,
      ),
    );
    expect(get.status).toBe(200);
    const input = {
      expectedVersion: 1,
      mapping: preview.mapping,
      affiliationMappings: {},
      excludedRowIds: [preview.items[0]!.id],
    };
    const changed = await fixture.app.handle(
      jsonRequest(
        `/v1/weddings/${wedding.id}/guest-imports/${preview.batchId}/mapping`,
        "PATCH",
        input,
      ),
    );
    expect(changed.status).toBe(200);
    await expect(changed.json()).resolves.toMatchObject({
      mappingVersion: 2,
      totals: { excluded: 1 },
    });
    const stale = await fixture.app.handle(
      jsonRequest(
        `/v1/weddings/${wedding.id}/guest-imports/${preview.batchId}/mapping`,
        "PATCH",
        input,
      ),
    );
    expect(stale.status).toBe(409);
  });

  it("commits reviewed import once and replays the same key without duplicate guests", async () => {
    const fixture = testFixture({ principal: couple("commit-owner") });
    const weddingResponse = await fixture.app.handle(
      jsonRequest("/v1/weddings", "POST", {
        name: "Commit wedding",
        timeZone: "UTC",
        locale: "en",
      }),
    );
    const wedding = (await weddingResponse.json()) as { id: string };
    const upload = await fixture.app.handle(
      trustedRequest(`/v1/weddings/${wedding.id}/guest-imports`, {
        method: "POST",
        origin: webOrigin,
        "content-type": "text/csv",
        body: "name\nNok\n",
      }),
    );
    const preview = (await upload.json()) as {
      batchId: string;
      items: Array<{ id: string }>;
    };
    const input = {
      expectedVersion: 1,
      includedRowIds: [preview.items[0]!.id],
      createAnywayRowIds: [],
      idempotencyKey: "commit-1",
    };
    const endpoint = `/v1/weddings/${wedding.id}/guest-imports/${preview.batchId}/commit`;
    const first = await fixture.app.handle(
      jsonRequest(endpoint, "POST", input),
    );
    expect(first.status).toBe(200);
    const result = await first.json();
    expect(result).toMatchObject({ created: 1, excluded: 0 });
    const replay = await fixture.app.handle(
      jsonRequest(endpoint, "POST", input),
    );
    expect(await replay.json()).toEqual(result);
    const guests = await fixture.app.handle(
      trustedRequest(`/v1/weddings/${wedding.id}/guests`),
    );
    expect(((await guests.json()) as { items: unknown[] }).items).toHaveLength(
      1,
    );
  });
  it("downloads scoped CSV with no-store and rejects unauthenticated export", async () => {
    const fixture = testFixture({ principal: couple("csv-owner") });
    const weddingResponse = await fixture.app.handle(
      jsonRequest("/v1/weddings", "POST", {
        name: "CSV wedding",
        timeZone: "UTC",
        locale: "en",
      }),
    );
    const wedding = (await weddingResponse.json()) as { id: string };
    await fixture.app.handle(
      jsonRequest(`/v1/weddings/${wedding.id}/guests`, "POST", {
        name: "คุณสมชาย",
        allowedPartySize: 1,
      }),
    );
    const response = await fixture.app.handle(
      trustedRequest(
        `/v1/weddings/${wedding.id}/guests/export.csv?view=active&search=%E0%B8%84%E0%B8%B8%E0%B8%93`,
      ),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/csv; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="lovechapter-guests.csv"',
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("คุณสมชาย");
    const unauthenticated = testFixture();
    const blocked = await unauthenticated.app.handle(
      trustedRequest(`/v1/weddings/${wedding.id}/guests/export.csv`),
    );
    expect(blocked.status).toBe(401);
  });
  it("keeps liveness credential-free and protects bounded readiness", async () => {
    const readiness = vi.fn(async () => undefined);
    const fixture = testFixture({ readiness });

    const live = await fixture.app.handle(
      new Request(`${apiOrigin}/health/live`),
    );
    const rejectedReady = await fixture.app.handle(
      new Request(`${apiOrigin}/health/ready`),
    );
    const ready = await fixture.app.handle(trustedRequest("/health/ready"));

    expect(live.status).toBe(200);
    await expect(live.json()).resolves.toEqual({ status: "ok" });
    expect(rejectedReady.status).toBe(403);
    expect(ready.status).toBe(200);
    expect(readiness).toHaveBeenCalledOnce();
  });

  it("serves protected release state without exposing lease details", async () => {
    const fixture = testFixture({ releaseMode: async () => "maintenance" });
    const rejected = await fixture.app.handle(
      new Request(`${apiOrigin}/health/release-state`),
    );
    const accepted = await fixture.app.handle(
      trustedRequest("/health/release-state"),
    );
    expect(rejected.status).toBe(403);
    expect(accepted.status).toBe(200);
    expect(accepted.headers.get("cache-control")).toBe("no-store");
    await expect(accepted.json()).resolves.toEqual({ mode: "maintenance" });
  });

  it("returns generic 202 responses for sign-up, resend, and forgot password", async () => {
    const fixture = testFixture();

    const signUp = await fixture.app.handle(
      jsonRequest("/v1/auth/sign-up", "POST", {
        displayName: "Mali & Arun",
        email: "couple@example.test",
        password,
      }),
    );
    const duplicate = await fixture.app.handle(
      jsonRequest("/v1/auth/sign-up", "POST", {
        displayName: "Mali & Arun",
        email: "couple@example.test",
        password,
      }),
    );
    const resend = await fixture.app.handle(
      jsonRequest("/v1/auth/verification-email", "POST", {
        email: "couple@example.test",
      }),
    );
    const forgot = await fixture.app.handle(
      jsonRequest("/v1/auth/forgot-password", "POST", {
        email: "missing@example.test",
      }),
    );

    for (const response of [signUp, duplicate, resend, forgot]) {
      expect(response.status).toBe(202);
      await expect(response.clone().json()).resolves.toEqual({
        accepted: true,
      });
    }
  });

  it("verifies email, signs in, and restores a cookie session", async () => {
    const fixture = testFixture();
    await signUp(fixture);

    const unverified = await fixture.app.handle(
      jsonRequest("/v1/auth/sign-in", "POST", {
        email: "couple@example.test",
        password,
      }),
    );
    expect(unverified.status).toBe(401);

    const verificationToken = fixture.rawToken("verify_email");
    const verified = await fixture.app.handle(
      jsonRequest("/v1/auth/verify-email", "POST", {
        token: verificationToken,
      }),
    );
    expect(verified.status).toBe(200);
    await expect(verified.json()).resolves.toEqual({ verified: true });

    const signedIn = await fixture.app.handle(
      jsonRequest("/v1/auth/sign-in", "POST", {
        email: "couple@example.test",
        password,
      }),
    );
    expect(signedIn.status).toBe(200);
    const cookie = signedIn.headers.get("set-cookie");
    expect(cookie).toContain("lovechapter_dev_session=");
    expect(cookie).toContain("HttpOnly");

    const session = await fixture.app.handle(
      trustedRequest("/v1/auth/session", { cookie: cookieHeader(cookie) }),
    );
    expect(session.status).toBe(200);
    await expect(session.json()).resolves.toMatchObject({
      user: {
        email: "couple@example.test",
        onboardingComplete: true,
      },
    });
  });

  it("signs out idempotently and clears the cookie", async () => {
    const fixture = testFixture();
    const cookie = await verifiedSessionCookie(fixture);

    const first = await fixture.app.handle(
      jsonRequest("/v1/auth/sign-out", "POST", {}, { cookie }),
    );
    const second = await fixture.app.handle(
      jsonRequest("/v1/auth/sign-out", "POST", {}, { cookie }),
    );

    expect(first.status).toBe(204);
    expect(second.status).toBe(204);
    expect(first.headers.get("set-cookie")).toContain("Max-Age=0");
    const restored = await fixture.app.handle(
      trustedRequest("/v1/auth/session", { cookie }),
    );
    expect(restored.status).toBe(401);
  });

  it("resets the password, revokes sessions, and clears the cookie", async () => {
    const fixture = testFixture();
    const cookie = await verifiedSessionCookie(fixture);
    const forgot = await fixture.app.handle(
      jsonRequest("/v1/auth/forgot-password", "POST", {
        email: "couple@example.test",
      }),
    );
    expect(forgot.status).toBe(202);

    const reset = await fixture.app.handle(
      jsonRequest(
        "/v1/auth/reset-password",
        "POST",
        { token: fixture.rawToken("reset_password"), password: `${password}!` },
        { cookie },
      ),
    );

    expect(reset.status).toBe(200);
    await expect(reset.json()).resolves.toEqual({ reset: true });
    expect(reset.headers.get("set-cookie")).toContain("Max-Age=0");
    const restored = await fixture.app.handle(
      trustedRequest("/v1/auth/session", { cookie }),
    );
    expect(restored.status).toBe(401);
  });

  it("maps rate limits to a stable 429 response", async () => {
    const fixture = testFixture();
    let response!: Response;
    for (let index = 0; index < 6; index += 1) {
      response = await fixture.app.handle(
        jsonRequest("/v1/auth/sign-up", "POST", {
          displayName: "Couple",
          email: `couple-${index}@example.test`,
          password,
        }),
      );
    }

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: { code: "rate_limited", message: "Too many requests" },
    });
  });

  it("rejects invalid ingress, cross-origin mutations, and non-JSON bodies", async () => {
    const fixture = testFixture();
    const noIngress = await fixture.app.handle(
      new Request(`${apiOrigin}/v1/auth/session`),
    );
    const crossOrigin = await fixture.app.handle(
      jsonRequest(
        "/v1/auth/sign-in",
        "POST",
        { email: "couple@example.test", password },
        { origin: "https://attacker.example" },
      ),
    );
    const nonJson = await fixture.app.handle(
      trustedRequest("/v1/auth/sign-in", {
        method: "POST",
        origin: webOrigin,
        "content-type": "text/plain",
        body: "not-json",
      }),
    );

    expect(noIngress.status).toBe(403);
    await expect(noIngress.json()).resolves.toMatchObject({
      error: { code: "request_ingress_rejected" },
    });
    expect(crossOrigin.status).toBe(403);
    await expect(crossOrigin.json()).resolves.toMatchObject({
      error: { code: "request_origin_rejected" },
    });
    expect(nonJson.status).toBe(400);
    await expect(nonJson.json()).resolves.toMatchObject({
      error: { code: "request_content_type_rejected" },
    });
  });

  it("fails closed when identity headers are spoofed", async () => {
    const fixture = testFixture();
    const response = await fixture.app.handle(
      trustedRequest("/v1/me", {
        "x-user-id": crypto.randomUUID(),
        "x-user-role": "owner",
      }),
    );

    expect(response.status).toBe(401);
  });

  it("keeps the protected and public RSVP flow unchanged", async () => {
    const fixture = testFixture({ principal: couple("one") });
    const weddingResponse = await fixture.app.handle(
      jsonRequest("/v1/weddings", "POST", {
        name: "Mali & Arun",
        weddingDate: "2027-02-14",
        timeZone: "Asia/Bangkok",
        locale: "en",
      }),
    );
    expect(weddingResponse.status).toBe(201);
    const wedding = (await weddingResponse.json()) as { id: string };

    const guestResponse = await fixture.app.handle(
      jsonRequest(`/v1/weddings/${wedding.id}/guests`, "POST", {
        name: "Nok",
        allowedPartySize: 2,
      }),
    );
    const guest = (await guestResponse.json()) as { id: string };
    const invitationResponse = await fixture.app.handle(
      jsonRequest(
        `/v1/weddings/${wedding.id}/guests/${guest.id}/invitations`,
        "POST",
        {},
      ),
    );
    const invitation = (await invitationResponse.json()) as { token: string };

    const publicResponse = await fixture.app.handle(
      trustedRequest(`/v1/public/invitations/${invitation.token}`),
    );
    expect(publicResponse.status).toBe(200);
    await expect(publicResponse.json()).resolves.toMatchObject({
      guest: { name: "Nok" },
      wedding: { name: "Mali & Arun" },
      rsvp: null,
    });

    const rsvp = await fixture.app.handle(
      jsonRequest(`/v1/public/invitations/${invitation.token}/rsvp`, "PUT", {
        attendance: "attending",
        partySize: 2,
      }),
    );
    expect(rsvp.status).toBe(200);
  });

  it("replaces an invitation over the protected API and rejects the old public link", async () => {
    const fixture = testFixture({ principal: couple("replacement-owner") });
    const weddingResponse = await fixture.app.handle(
      jsonRequest("/v1/weddings", "POST", {
        name: "Mali & Arun",
        timeZone: "Asia/Bangkok",
        locale: "en",
      }),
    );
    const wedding = (await weddingResponse.json()) as { id: string };
    const guestResponse = await fixture.app.handle(
      jsonRequest(`/v1/weddings/${wedding.id}/guests`, "POST", {
        name: "Nok",
        allowedPartySize: 1,
      }),
    );
    const guest = (await guestResponse.json()) as { id: string };
    const path = `/v1/weddings/${wedding.id}/guests/${guest.id}/invitations`;
    const originalResponse = await fixture.app.handle(
      jsonRequest(path, "POST", {}),
    );
    const original = (await originalResponse.json()) as { token: string };

    const response = await fixture.app.handle(
      jsonRequest(`${path}/replace`, "POST", {}),
    );
    expect(response.status).toBe(201);
    const replacement = (await response.json()) as { token: string };
    expect(replacement.token).not.toBe(original.token);
    expect(
      (
        await fixture.app.handle(
          trustedRequest(`/v1/public/invitations/${original.token}`),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await fixture.app.handle(
          trustedRequest(`/v1/public/invitations/${replacement.token}`),
        )
      ).status,
    ).toBe(200);
  });

  it("manages wedding-defined guest affiliations without seeded categories", async () => {
    const fixture = testFixture({ principal: couple("affiliations") });
    const weddingResponse = await fixture.app.handle(
      jsonRequest("/v1/weddings", "POST", {
        name: "Mali & Arun",
        timeZone: "Asia/Bangkok",
        locale: "en",
      }),
    );
    const wedding = (await weddingResponse.json()) as { id: string };

    const initiallyEmpty = await fixture.app.handle(
      trustedRequest(`/v1/weddings/${wedding.id}/guest-affiliations`),
    );
    expect(initiallyEmpty.status).toBe(200);
    await expect(initiallyEmpty.json()).resolves.toEqual([]);

    const familyResponse = await fixture.app.handle(
      jsonRequest(`/v1/weddings/${wedding.id}/guest-affiliations`, "POST", {
        name: "  Family  ",
        color: "#A855F7",
      }),
    );
    const friendsResponse = await fixture.app.handle(
      jsonRequest(`/v1/weddings/${wedding.id}/guest-affiliations`, "POST", {
        name: "Friends",
        color: "#0EA5E9",
      }),
    );
    expect(familyResponse.status).toBe(201);
    expect(friendsResponse.status).toBe(201);
    const family = (await familyResponse.json()) as {
      id: string;
      name: string;
    };
    const friends = (await friendsResponse.json()) as { id: string };
    expect(family.name).toBe("Family");

    const renamed = await fixture.app.handle(
      jsonRequest(
        `/v1/weddings/${wedding.id}/guest-affiliations/${family.id}`,
        "PATCH",
        { name: "Bride's family", color: "#DB2777" },
      ),
    );
    expect(renamed.status).toBe(200);
    await expect(renamed.json()).resolves.toMatchObject({
      id: family.id,
      name: "Bride's family",
      color: "#db2777",
    });

    const reordered = await fixture.app.handle(
      jsonRequest(
        `/v1/weddings/${wedding.id}/guest-affiliations/order`,
        "PUT",
        { ids: [friends.id, family.id] },
      ),
    );
    expect(reordered.status).toBe(200);
    await expect(reordered.json()).resolves.toMatchObject([
      { id: friends.id, sortOrder: 0 },
      { id: family.id, sortOrder: 1 },
    ]);
  });

  it("unassigns guests instead of deleting them when an affiliation is deleted", async () => {
    const fixture = testFixture({ principal: couple("safe-delete") });
    const weddingResponse = await fixture.app.handle(
      jsonRequest("/v1/weddings", "POST", {
        name: "Mali & Arun",
        timeZone: "UTC",
        locale: "en",
      }),
    );
    const wedding = (await weddingResponse.json()) as { id: string };
    const affiliationResponse = await fixture.app.handle(
      jsonRequest(`/v1/weddings/${wedding.id}/guest-affiliations`, "POST", {
        name: "Work friends",
        color: "#475569",
      }),
    );
    const affiliation = (await affiliationResponse.json()) as { id: string };

    const guestResponse = await fixture.app.handle(
      jsonRequest(`/v1/weddings/${wedding.id}/guests`, "POST", {
        name: "Nok",
        allowedPartySize: 1,
      }),
    );
    expect(guestResponse.status).toBe(201);
    await expect(guestResponse.json()).resolves.toMatchObject({
      name: "Nok",
      affiliation: null,
    });
    const guest = (await fixture.app
      .handle(trustedRequest(`/v1/weddings/${wedding.id}/guests`))
      .then((response) => response.json())) as {
      items: [{ id: string }];
    };

    const assigned = await fixture.app.handle(
      jsonRequest(
        `/v1/weddings/${wedding.id}/guests/${guest.items[0].id}/affiliation`,
        "PATCH",
        { affiliationId: affiliation.id },
      ),
    );
    expect(assigned.status).toBe(200);
    await expect(assigned.json()).resolves.toMatchObject({
      name: "Nok",
      affiliation: { id: affiliation.id, name: "Work friends" },
    });

    const removed = await fixture.app.handle(
      jsonRequest(
        `/v1/weddings/${wedding.id}/guest-affiliations/${affiliation.id}`,
        "DELETE",
        {},
      ),
    );
    expect(removed.status).toBe(204);

    const guests = await fixture.app.handle(
      trustedRequest(`/v1/weddings/${wedding.id}/guests`),
    );
    await expect(guests.json()).resolves.toMatchObject({
      items: [{ name: "Nok", affiliation: null }],
    });
  });

  it("manages guest detail, archive, restore, and bounded bulk actions", async () => {
    const fixture = testFixture({ principal: couple("guest-management") });
    const weddingResponse = await fixture.app.handle(
      jsonRequest("/v1/weddings", "POST", {
        name: "Mali & Arun",
        timeZone: "UTC",
        locale: "en",
      }),
    );
    const wedding = (await weddingResponse.json()) as { id: string };
    const affiliationResponse = await fixture.app.handle(
      jsonRequest(`/v1/weddings/${wedding.id}/guest-affiliations`, "POST", {
        name: "Family",
        color: "#a855f7",
      }),
    );
    const affiliation = (await affiliationResponse.json()) as { id: string };
    const firstResponse = await fixture.app.handle(
      jsonRequest(`/v1/weddings/${wedding.id}/guests`, "POST", {
        name: "สมชาย",
        email: "somchai@example.test",
        phone: "+66 80 000 0000",
        allowedPartySize: 2,
        envelopeName: "คุณสมชายและครอบครัว",
        note: "Vegetarian",
        postalAddress: {
          addressLine1: "1 Main Street",
          locality: "Bangkok",
          countryCode: "TH",
        },
      }),
    );
    const first = (await firstResponse.json()) as { id: string };
    const secondResponse = await fixture.app.handle(
      jsonRequest(`/v1/weddings/${wedding.id}/guests`, "POST", {
        name: "Suda",
        allowedPartySize: 1,
      }),
    );
    const second = (await secondResponse.json()) as { id: string };

    const filtered = await fixture.app.handle(
      trustedRequest(
        `/v1/weddings/${wedding.id}/guests?limit=20&view=active&rsvp=pending&affiliation=unassigned&search=${encodeURIComponent("สม")}`,
      ),
    );
    expect(filtered.status).toBe(200);
    await expect(filtered.json()).resolves.toMatchObject({
      items: [{ id: first.id, phone: "+66 80 000 0000" }],
    });

    const detail = await fixture.app.handle(
      trustedRequest(`/v1/weddings/${wedding.id}/guests/${first.id}`),
    );
    expect(detail.status).toBe(200);
    await expect(detail.json()).resolves.toMatchObject({
      envelopeName: "คุณสมชายและครอบครัว",
      note: "Vegetarian",
      postalAddress: { addressLine1: "1 Main Street" },
    });

    const updated = await fixture.app.handle(
      jsonRequest(`/v1/weddings/${wedding.id}/guests/${first.id}`, "PATCH", {
        phone: " ",
        postalAddress: null,
      }),
    );
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      postalAddress: null,
    });

    const bulkAffiliation = await fixture.app.handle(
      jsonRequest(
        `/v1/weddings/${wedding.id}/guests/bulk-affiliation`,
        "PATCH",
        { guestIds: [first.id, second.id], affiliationId: affiliation.id },
      ),
    );
    expect(bulkAffiliation.status).toBe(200);
    await expect(bulkAffiliation.json()).resolves.toEqual({ affected: 2 });

    const archived = await fixture.app.handle(
      jsonRequest(
        `/v1/weddings/${wedding.id}/guests/${first.id}/archive`,
        "POST",
        {},
      ),
    );
    expect(archived.status).toBe(200);
    await expect(archived.json()).resolves.toHaveProperty("archivedAt");
    const archivedList = await fixture.app.handle(
      trustedRequest(`/v1/weddings/${wedding.id}/guests?view=archived`),
    );
    await expect(archivedList.json()).resolves.toMatchObject({
      items: [{ id: first.id }],
    });

    const restored = await fixture.app.handle(
      jsonRequest(
        `/v1/weddings/${wedding.id}/guests/${first.id}/restore`,
        "POST",
        {},
      ),
    );
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.not.toHaveProperty("archivedAt");

    const bulkArchived = await fixture.app.handle(
      jsonRequest(`/v1/weddings/${wedding.id}/guests/bulk-archive`, "POST", {
        guestIds: [first.id, second.id],
      }),
    );
    expect(bulkArchived.status).toBe(200);
    await expect(bulkArchived.json()).resolves.toEqual({ affected: 2 });
  });

  it("rejects invalid guest filters, patches, and bulk bodies", async () => {
    const fixture = testFixture({ principal: couple("guest-validation") });
    const weddingResponse = await fixture.app.handle(
      jsonRequest("/v1/weddings", "POST", {
        name: "Mali & Arun",
        timeZone: "UTC",
        locale: "en",
      }),
    );
    const wedding = (await weddingResponse.json()) as { id: string };
    const guestResponse = await fixture.app.handle(
      jsonRequest(`/v1/weddings/${wedding.id}/guests`, "POST", {
        name: "Nok",
        allowedPartySize: 1,
      }),
    );
    const guest = (await guestResponse.json()) as { id: string };
    const invalidRequests = [
      trustedRequest(`/v1/weddings/${wedding.id}/guests?limit=101`),
      trustedRequest(`/v1/weddings/${wedding.id}/guests?view=deleted`),
      trustedRequest(`/v1/weddings/${wedding.id}/guests?rsvp=maybe`),
      trustedRequest(`/v1/weddings/${wedding.id}/guests?affiliation=bad`),
      trustedRequest(`/v1/weddings/${wedding.id}/guests?cursor=bad`),
      jsonRequest(`/v1/weddings/${wedding.id}/guests/${guest.id}`, "PATCH", {
        unknown: true,
      }),
      jsonRequest(
        `/v1/weddings/${wedding.id}/guests/bulk-affiliation`,
        "PATCH",
        { guestIds: [], affiliationId: null },
      ),
      jsonRequest(`/v1/weddings/${wedding.id}/guests/bulk-archive`, "POST", {
        guestIds: [guest.id, guest.id],
      }),
      jsonRequest(`/v1/weddings/${wedding.id}/guests/bulk-archive`, "POST", {
        guestIds: Array.from({ length: 201 }, () => crypto.randomUUID()),
      }),
    ];

    for (const request of invalidRequests) {
      const response = await fixture.app.handle(request);
      expect(response.status).toBe(400);
    }
  });

  it("maps cross-wedding guest operations to a non-disclosing 404", async () => {
    const fixture = testFixture({ principal: couple("guest-scope") });
    const createWedding = async (name: string) => {
      const response = await fixture.app.handle(
        jsonRequest("/v1/weddings", "POST", {
          name,
          timeZone: "UTC",
          locale: "en",
        }),
      );
      return (await response.json()) as { id: string };
    };
    const first = await createWedding("First");
    const second = await createWedding("Second");
    const guestResponse = await fixture.app.handle(
      jsonRequest(`/v1/weddings/${first.id}/guests`, "POST", {
        name: "Nok",
        allowedPartySize: 1,
      }),
    );
    const guest = (await guestResponse.json()) as { id: string };

    const response = await fixture.app.handle(
      trustedRequest(`/v1/weddings/${second.id}/guests/${guest.id}`),
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "not_found", message: "Resource not found" },
    });
  });
});

type Fixture = ReturnType<typeof testFixture>;

function testFixture(
  options: {
    readiness?: () => Promise<void>;
    releaseMode?: () => Promise<"open" | "maintenance">;
    principal?: Principal;
    operationsRepository?: WeddingOperationsRepository;
  } = {},
) {
  const authRepository = new InMemoryAuthRepository();
  const actionTokenCodec = createActionTokenCodec({
    activeVersion: 1,
    keys: new Map([[1, new Uint8Array(32).fill(3)]]),
  });
  const authService = new AuthService({
    repository: authRepository,
    passwordHasher: testPasswordHasher,
    actionTokenCodec,
    clock: { now: () => new Date("2026-09-22T12:00:00.000Z") },
    rateLimitSecret: new Uint8Array(32).fill(5),
  });
  const identity: IdentityProvider = options.principal
    ? createConfiguredIdentityProvider({
        AUTH_MODE: "development",
        DEV_AUTH_SUBJECT: options.principal.subject,
        DEV_AUTH_DISPLAY_NAME: options.principal.displayName,
        ...(options.principal.email
          ? { DEV_AUTH_EMAIL: options.principal.email }
          : {}),
      })
    : createApiIdentityProvider(
        { AUTH_MODE: "local" },
        { authService, nodeEnvironment: "test" },
      );
  const domainRepository = new InMemoryLoveChapterRepository();
  const guestImportRepository = new InMemoryGuestImportRepository(
    domainRepository,
  );
  const envelopeRepository = new InMemoryEnvelopeRepository(domainRepository);
  const planningRepository = new InMemoryPlanningRepository(domainRepository);
  const app = createApiApp({
    authService,
    nodeEnvironment: "test",
    publicWebOrigin: webOrigin,
    proxyCredential,
    fingerprintKey,
    readiness: options.readiness ?? (async () => undefined),
    releaseMode: options.releaseMode ?? (async () => "open"),
    run: (request, operation) =>
      operation(
        new LoveChapterService(
          identity,
          domainRepository,
          webOrigin,
          request,
          guestImportRepository,
          envelopeRepository,
          planningRepository,
          options.operationsRepository,
        ),
      ),
  }).compile();
  return {
    app,
    authRepository,
    rawToken(purpose: "verify_email" | "reset_password") {
      const metadata = authRepository.currentToken(purpose);
      if (!metadata) throw new Error(`Missing ${purpose} token`);
      return actionTokenCodec.create(metadata);
    },
  };
}

async function signUp(fixture: Fixture): Promise<void> {
  const response = await fixture.app.handle(
    jsonRequest("/v1/auth/sign-up", "POST", {
      displayName: "Mali & Arun",
      email: "couple@example.test",
      password,
    }),
  );
  expect(response.status).toBe(202);
}

async function verifiedSessionCookie(fixture: Fixture): Promise<string> {
  await signUp(fixture);
  const verified = await fixture.app.handle(
    jsonRequest("/v1/auth/verify-email", "POST", {
      token: fixture.rawToken("verify_email"),
    }),
  );
  expect(verified.status).toBe(200);
  const signedIn = await fixture.app.handle(
    jsonRequest("/v1/auth/sign-in", "POST", {
      email: "couple@example.test",
      password,
    }),
  );
  expect(signedIn.status).toBe(200);
  return cookieHeader(signedIn.headers.get("set-cookie"));
}

const testPasswordHasher: PasswordHasher = {
  async hash(value) {
    return `test-hash:${value}`;
  },
  async verify(value, envelope) {
    return { valid: envelope === `test-hash:${value}`, needsRehash: false };
  },
  async verifySynthetic() {},
};

function couple(subject: string): Principal {
  return {
    provider: "development",
    subject,
    displayName: `Couple ${subject}`,
    email: `${subject}@example.test`,
  };
}

function trustedRequest(
  path: string,
  init: Record<string, string> = {},
): Request {
  const { method, body, ...headers } = init;
  return new Request(new URL(path, apiOrigin), {
    ...(method === undefined ? {} : { method }),
    headers: {
      [PROXY_CREDENTIAL_HEADER]: proxyCredential,
      [CLIENT_ADDRESS_HEADER]: "203.0.113.10",
      ...headers,
    },
    ...(body === undefined ? {} : { body }),
  });
}

function jsonRequest(
  path: string,
  method: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return trustedRequest(path, {
    method,
    "content-type": "application/json",
    origin: webOrigin,
    body: JSON.stringify(body),
    ...headers,
  });
}

function cookieHeader(setCookie: string | null): string {
  if (!setCookie) throw new Error("Missing Set-Cookie header");
  const [cookie] = setCookie.split(";", 1);
  if (!cookie) throw new Error("Invalid Set-Cookie header");
  return cookie;
}
