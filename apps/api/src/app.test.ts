import {
  createConfiguredIdentityProvider,
  type IdentityProvider,
  LoveChapterService,
  type Principal,
} from "@lovechapter/domain";
import { InMemoryLoveChapterRepository } from "@lovechapter/domain/testing";
import { describe, expect, it, vi } from "vitest";

import { createApiApp } from "./app";
import { createClerkIdentityProvider } from "./clerk-identity";

const apiOrigin = "https://api.example.test";
const webOrigin = "https://web.example.test";

describe("LoveChapter API", () => {
  it.each(["missing", "malformed", "expired", "wrong-party", "missing-email"])(
    "returns 401 without synchronizing a %s Clerk session",
    async (sessionCase) => {
      const repository = new InMemoryLoveChapterRepository();
      const synchronize = vi.spyOn(repository, "syncUser");
      const identity = createClerkIdentityProvider(
        clerkConfig,
        async () => null,
      );
      const app = appWithIdentity(repository, identity);
      const headers =
        sessionCase === "missing"
          ? { origin: webOrigin }
          : {
              origin: webOrigin,
              authorization: `Bearer ${sessionCase}`,
            };

      const response = await app.handle(
        new Request(`${apiOrigin}/v1/me`, { headers }),
      );

      expect(response.status).toBe(401);
      expect(synchronize).not.toHaveBeenCalled();
    },
  );

  it("fails closed when auth is disabled even if identity headers are spoofed", async () => {
    const repository = new InMemoryLoveChapterRepository();
    const app = testApp(repository, null);

    const response = await app.handle(
      new Request(`${apiOrigin}/v1/me`, {
        headers: {
          origin: webOrigin,
          "x-user-id": crypto.randomUUID(),
          "x-user-role": "owner",
        },
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe(webOrigin);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "authentication_required",
        message: "Authentication required",
      },
    });
  });

  it("maps request validation failures to 400", async () => {
    const app = testApp(new InMemoryLoveChapterRepository(), couple("one"));

    const response = await app.handle(
      jsonRequest("/v1/weddings", "POST", {
        name: "",
        timeZone: "UTC",
        locale: "en",
        unexpected: true,
      }),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("access-control-allow-origin")).toBe(webOrigin);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error" },
    });
  });

  it("allows an incomplete Clerk user to finish profile onboarding", async () => {
    const repository = new InMemoryLoveChapterRepository();
    const identity = validClerkIdentity();
    const app = appWithIdentity(repository, identity);

    const response = await app.handle(
      jsonRequest("/v1/me", "PATCH", { displayName: "คู่รัก" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      displayName: "คู่รัก",
      onboardingComplete: true,
    });
  });

  it("blocks an incomplete Clerk user from workspace operations", async () => {
    const app = appWithIdentity(
      new InMemoryLoveChapterRepository(),
      validClerkIdentity(),
    );

    const response = await app.handle(
      jsonRequest("/v1/weddings", "POST", {
        name: "Mali & Arun",
        timeZone: "UTC",
        locale: "en",
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "onboarding_required",
        message: "Profile setup required",
      },
    });
  });

  it("serves the complete protected and public RSVP flow", async () => {
    const repository = new InMemoryLoveChapterRepository();
    const app = testApp(repository, couple("one"));

    const weddingResponse = await app.handle(
      jsonRequest("/v1/weddings", "POST", {
        name: "Mali & Arun",
        weddingDate: "2027-02-14",
        timeZone: "Asia/Bangkok",
        locale: "en",
      }),
    );
    expect(weddingResponse.status).toBe(201);
    const wedding = (await weddingResponse.json()) as { id: string };

    const guestResponse = await app.handle(
      jsonRequest(`/v1/weddings/${wedding.id}/guests`, "POST", {
        name: "Nok",
        allowedPartySize: 2,
      }),
    );
    expect(guestResponse.status).toBe(201);
    const guest = (await guestResponse.json()) as { id: string };

    const invitationResponse = await app.handle(
      jsonRequest(
        `/v1/weddings/${wedding.id}/guests/${guest.id}/invitations`,
        "POST",
        {},
      ),
    );
    expect(invitationResponse.status).toBe(201);
    const invitation = (await invitationResponse.json()) as { token: string };

    const publicResponse = await app.handle(
      new Request(`${apiOrigin}/v1/public/invitations/${invitation.token}`),
    );
    expect(publicResponse.status).toBe(200);
    await expect(publicResponse.json()).resolves.toMatchObject({
      guest: { name: "Nok" },
      wedding: { name: "Mali & Arun" },
      rsvp: null,
    });

    const invalidRsvp = await app.handle(
      jsonRequest(`/v1/public/invitations/${invitation.token}/rsvp`, "PUT", {
        attendance: "attending",
        partySize: 3,
      }),
    );
    expect(invalidRsvp.status).toBe(400);

    const validRsvp = await app.handle(
      jsonRequest(`/v1/public/invitations/${invitation.token}/rsvp`, "PUT", {
        attendance: "attending",
        partySize: 2,
      }),
    );
    expect(validRsvp.status).toBe(200);

    const guestsResponse = await app.handle(
      new Request(`${apiOrigin}/v1/weddings/${wedding.id}/guests?limit=20`),
    );
    await expect(guestsResponse.json()).resolves.toMatchObject({
      items: [{ rsvp: { attendance: "attending", partySize: 2 } }],
    });
  });

  it("returns 404 instead of revealing another Couple's wedding", async () => {
    const repository = new InMemoryLoveChapterRepository();
    const ownerApp = testApp(repository, couple("owner"));
    const created = await ownerApp.handle(
      jsonRequest("/v1/weddings", "POST", {
        name: "Private Wedding",
        timeZone: "UTC",
        locale: "en",
      }),
    );
    expect(created.status).toBe(201);
    const wedding = (await created.json()) as { id: string };

    const otherApp = testApp(repository, couple("other"));
    const response = await otherApp.handle(
      new Request(`${apiOrigin}/v1/weddings/${wedding.id}/guests?limit=20`),
    );

    expect(response.status).toBe(404);
  });

  it("allows only the configured browser origin", async () => {
    const app = testApp(new InMemoryLoveChapterRepository(), couple("one"));

    const allowed = await app.handle(
      new Request(`${apiOrigin}/health`, { headers: { origin: webOrigin } }),
    );
    const rejected = await app.handle(
      new Request(`${apiOrigin}/health`, {
        headers: { origin: "https://attacker.example" },
      }),
    );

    expect(allowed.headers.get("access-control-allow-origin")).toBe(webOrigin);
    expect(rejected.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("allows bearer-token profile updates in CORS preflight", async () => {
    const app = testApp(new InMemoryLoveChapterRepository(), couple("one"));

    const response = await app.handle(
      new Request(`${apiOrigin}/v1/me`, {
        method: "OPTIONS",
        headers: { origin: webOrigin },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "Content-Type, Authorization",
    );
    expect(response.headers.get("access-control-allow-methods")).toBe(
      "GET,POST,PUT,PATCH,OPTIONS",
    );
  });
});

const clerkConfig = {
  publishableKey: "pk_test_example",
  jwtKey: "test-public-key",
  publicWebOrigin: webOrigin,
};

function testApp(
  repository: InMemoryLoveChapterRepository,
  principal: Principal | null,
) {
  const identity = principal
    ? createConfiguredIdentityProvider({
        AUTH_MODE: "development",
        DEV_AUTH_SUBJECT: principal.subject,
        DEV_AUTH_DISPLAY_NAME: principal.displayName,
        ...(principal.email ? { DEV_AUTH_EMAIL: principal.email } : {}),
      })
    : createConfiguredIdentityProvider({ AUTH_MODE: "disabled" });
  return appWithIdentity(repository, identity);
}

function appWithIdentity(
  repository: InMemoryLoveChapterRepository,
  identity: IdentityProvider,
) {
  return createApiApp({
    publicWebOrigin: webOrigin,
    run: (request, operation) =>
      operation(
        new LoveChapterService(identity, repository, webOrigin, request),
      ),
  }).compile();
}

function validClerkIdentity(): IdentityProvider {
  return createClerkIdentityProvider(clerkConfig, async () => ({
    subject: "user_clerk",
    primaryEmail: "couple@example.test",
  }));
}

function couple(subject: string): Principal {
  return {
    provider: "development",
    subject,
    displayName: `Couple ${subject}`,
    email: `${subject}@example.test`,
  };
}

function jsonRequest(path: string, method: string, body: unknown): Request {
  return new Request(new URL(path, apiOrigin), {
    method,
    headers: { "content-type": "application/json", origin: webOrigin },
    body: JSON.stringify(body),
  });
}
