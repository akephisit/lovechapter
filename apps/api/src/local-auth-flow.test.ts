import {
  AuthService,
  createActionTokenCodec,
  type PasswordHasher,
} from "@lovechapter/auth";
import { InMemoryAuthRepository } from "@lovechapter/auth/testing";
import { LoveChapterService } from "@lovechapter/domain";
import { InMemoryLoveChapterRepository } from "@lovechapter/domain/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApiIdentityProvider } from "./api-identity";
import { createApiApp } from "./app";
import {
  CLIENT_ADDRESS_HEADER,
  PROXY_CREDENTIAL_HEADER,
} from "./request-security";

const apiOrigin = "https://api.example.test";
const webOrigin = "https://web.example.test";
const proxyCredential = "proxy-credential-that-is-at-least-32-bytes";
const originalPassword = "correct horse battery staple";
const replacementPassword = "new correct horse battery staple";

afterEach(() => vi.restoreAllMocks());

describe("provider-free MVP vertical slice", () => {
  it("completes local auth, wedding, guest, public RSVP, and password reset", async () => {
    const fixture = flowFixture();
    const capturedLogs: string[] = [];
    for (const method of ["log", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...values: unknown[]) => {
        capturedLogs.push(values.map(String).join(" "));
      });
    }

    const signUp = await fixture.app.handle(
      jsonRequest("/v1/auth/sign-up", "POST", {
        displayName: "Mali & Arun",
        email: "couple@example.test",
        password: originalPassword,
      }),
    );
    const duplicate = await fixture.app.handle(
      jsonRequest("/v1/auth/sign-up", "POST", {
        displayName: "Different name",
        email: "couple@example.test",
        password: originalPassword,
      }),
    );
    await expectAccepted(signUp);
    await expectAccepted(duplicate);

    const verificationJob = fixture.onlyActiveJob("verify_email");
    const verificationToken = fixture.reconstructToken(
      verificationJob.authTokenId,
    );
    expect(verificationToken).toMatch(/^lc1\.[A-Za-z0-9_.-]+$/);

    const verify = await fixture.app.handle(
      jsonRequest("/v1/auth/verify-email", "POST", {
        token: verificationToken,
      }),
    );
    expect(verify.status).toBe(200);

    const signIn = await fixture.app.handle(
      jsonRequest("/v1/auth/sign-in", "POST", {
        email: "couple@example.test",
        password: originalPassword,
      }),
    );
    expect(signIn.status).toBe(200);
    const cookie = cookieHeader(signIn.headers.get("set-cookie"));

    const session = await fixture.app.handle(
      trustedRequest("/v1/auth/session", { cookie }),
    );
    expect(session.status).toBe(200);
    await expect(session.json()).resolves.toMatchObject({
      user: { email: "couple@example.test", onboardingComplete: true },
    });

    const weddingResponse = await fixture.app.handle(
      jsonRequest(
        "/v1/weddings",
        "POST",
        {
          name: "Mali & Arun",
          weddingDate: "2027-02-14",
          timeZone: "Asia/Bangkok",
          locale: "en",
        },
        { cookie },
      ),
    );
    expect(weddingResponse.status).toBe(201);
    const wedding = (await weddingResponse.json()) as { id: string };

    const guestResponse = await fixture.app.handle(
      jsonRequest(
        `/v1/weddings/${wedding.id}/guests`,
        "POST",
        { name: "Nok", allowedPartySize: 2 },
        { cookie },
      ),
    );
    expect(guestResponse.status).toBe(201);
    const guest = (await guestResponse.json()) as { id: string };

    const invitationResponse = await fixture.app.handle(
      jsonRequest(
        `/v1/weddings/${wedding.id}/guests/${guest.id}/invitations`,
        "POST",
        {},
        { cookie },
      ),
    );
    expect(invitationResponse.status).toBe(201);
    const invitation = (await invitationResponse.json()) as { token: string };

    const publicInvitation = await fixture.app.handle(
      trustedRequest(`/v1/public/invitations/${invitation.token}`),
    );
    expect(publicInvitation.status).toBe(200);
    await expect(publicInvitation.json()).resolves.toMatchObject({
      guest: { name: "Nok" },
      rsvp: null,
    });

    const publicRsvp = await fixture.app.handle(
      jsonRequest(`/v1/public/invitations/${invitation.token}/rsvp`, "PUT", {
        attendance: "attending",
        partySize: 2,
        note: "Can't wait!",
      }),
    );
    expect(publicRsvp.status).toBe(200);

    const guestList = await fixture.app.handle(
      trustedRequest(`/v1/weddings/${wedding.id}/guests?limit=20`, {
        cookie,
      }),
    );
    expect(guestList.status).toBe(200);
    await expect(guestList.json()).resolves.toMatchObject({
      items: [
        {
          name: "Nok",
          rsvp: { attendance: "attending", partySize: 2 },
        },
      ],
    });

    const unknownForgot = await fixture.app.handle(
      jsonRequest("/v1/auth/forgot-password", "POST", {
        email: "missing@example.test",
      }),
    );
    const forgot = await fixture.app.handle(
      jsonRequest("/v1/auth/forgot-password", "POST", {
        email: "couple@example.test",
      }),
    );
    await expectAccepted(unknownForgot);
    await expectAccepted(forgot);

    const resetJob = fixture.onlyActiveJob("reset_password");
    const resetToken = fixture.reconstructToken(resetJob.authTokenId);
    const reset = await fixture.app.handle(
      jsonRequest(
        "/v1/auth/reset-password",
        "POST",
        { token: resetToken, password: replacementPassword },
        { cookie },
      ),
    );
    expect(reset.status).toBe(200);
    expect(reset.headers.get("set-cookie")).toContain("Max-Age=0");

    const revokedSession = await fixture.app.handle(
      trustedRequest("/v1/auth/session", { cookie }),
    );
    expect(revokedSession.status).toBe(401);

    const oldPassword = await fixture.app.handle(
      jsonRequest("/v1/auth/sign-in", "POST", {
        email: "couple@example.test",
        password: originalPassword,
      }),
    );
    expect(oldPassword.status).toBe(401);
    const newPassword = await fixture.app.handle(
      jsonRequest("/v1/auth/sign-in", "POST", {
        email: "couple@example.test",
        password: replacementPassword,
      }),
    );
    expect(newPassword.status).toBe(200);

    expect(capturedLogs.join("\n")).not.toContain(verificationToken);
    expect(capturedLogs.join("\n")).not.toContain(resetToken);
  });
});

function flowFixture() {
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
  const identity = createApiIdentityProvider(
    { AUTH_MODE: "local" },
    { authService, nodeEnvironment: "test" },
  );
  const domainRepository = new InMemoryLoveChapterRepository({
    now: () => new Date("2026-09-22T12:00:00.000Z"),
  });
  const app = createApiApp({
    authService,
    nodeEnvironment: "test",
    publicWebOrigin: webOrigin,
    proxyCredential,
    fingerprintKey: new Uint8Array(32).fill(7),
    readiness: async () => undefined,
    releaseMode: async () => "open",
    run: (request, operation) =>
      operation(
        new LoveChapterService(identity, domainRepository, webOrigin, request),
      ),
  }).compile();

  return {
    app,
    onlyActiveJob(purpose: "verify_email" | "reset_password") {
      const jobs = authRepository.currentJobs(purpose);
      expect(jobs).toHaveLength(1);
      const job = jobs[0];
      if (!job) throw new Error(`Missing ${purpose} job`);
      return job;
    },
    reconstructToken(tokenId: string) {
      const metadata = authRepository.tokensById.get(tokenId);
      if (!metadata) throw new Error(`Missing action token ${tokenId}`);
      return actionTokenCodec.reconstruct(metadata);
    },
  };
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

async function expectAccepted(response: Response): Promise<void> {
  expect(response.status).toBe(202);
  await expect(response.json()).resolves.toEqual({ accepted: true });
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
