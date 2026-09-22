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
} from "@lovechapter/domain";
import { InMemoryLoveChapterRepository } from "@lovechapter/domain/testing";
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
});

type Fixture = ReturnType<typeof testFixture>;

function testFixture(
  options: {
    readiness?: () => Promise<void>;
    principal?: Principal;
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
  const app = createApiApp({
    authService,
    nodeEnvironment: "test",
    publicWebOrigin: webOrigin,
    proxyCredential,
    fingerprintKey,
    readiness: options.readiness ?? (async () => undefined),
    run: (request, operation) =>
      operation(
        new LoveChapterService(identity, domainRepository, webOrigin, request),
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
