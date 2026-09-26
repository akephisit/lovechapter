import { describe, expect, it, vi } from "vitest";

import {
  createPostgresFixtureStore,
  runStagingHttpAcceptance,
} from "./staging-http.mjs";

const sha = "a".repeat(40);
const origin = "https://lovechapter-web-staging.example.workers.dev";
const weddingId = "11111111-1111-4111-8111-111111111111";
const foreignWeddingId = "22222222-2222-4222-8222-222222222222";
const guestId = "33333333-3333-4333-8333-333333333333";
const batchId = "44444444-4444-4444-8444-444444444444";
const rowId = "55555555-5555-4555-8555-555555555555";
const token = "A".repeat(43);

function json(value, status = 200, headers = {}) {
  return new globalThis.Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function fixture(overrides = {}) {
  const requests = [];
  const records = [];
  const store = {
    snapshotOutbox: vi.fn(async () => ({
      existingJobIds: [],
      accountAbsent: true,
    })),
    observeOutbox: vi.fn(async () => true),
    captureVerificationAccount: vi.fn(
      async () => "77777777-7777-4777-8777-777777777777",
    ),
    foreignWeddingId: vi.fn(async () => foreignWeddingId),
    record: vi.fn(async (kind, id) => records.push({ kind, id })),
    cleanup: vi.fn(async () => undefined),
    ...overrides.store,
  };
  const fetcher = vi.fn(async (url, options = {}) => {
    const path = new globalThis.URL(url).pathname;
    const method = options.method ?? "GET";
    requests.push({
      path,
      method,
      headers: options.headers,
      body: options.body,
    });
    const key = `${method} ${path}`;
    if (overrides.response?.[key]) return overrides.response[key];
    switch (key) {
      case "POST /api/v1/auth/sign-up":
      case "POST /api/v1/auth/verification-email":
      case "POST /api/v1/auth/forgot-password":
        return json({ accepted: true }, 202);
      case "POST /api/v1/auth/sign-in":
        return json({ signedIn: true }, 200, {
          "set-cookie":
            "__Host-lovechapter_session=session-value; Path=/; Secure; HttpOnly",
        });
      case "GET /api/v1/auth/session":
        if (requests.some((request) => request.path.endsWith("/sign-out"))) {
          return json({ error: "unauthorized" }, 401);
        }
        return json({
          user: {
            id: "66666666-6666-4666-8666-666666666666",
            email: "verified@example.test",
          },
        });
      case "POST /api/v1/auth/sign-out":
        return new globalThis.Response(null, { status: 204 });
      case "POST /api/v1/weddings":
        return json({ id: weddingId }, 201);
      case `GET /api/v1/weddings/${foreignWeddingId}/guests`:
        return json({ error: "not_found" }, 404);
      case `POST /api/v1/weddings/${weddingId}/guests`:
        return json({ id: guestId }, 201);
      case `POST /api/v1/weddings/${weddingId}/guests/${guestId}/invitations`:
        return json({ token }, 201);
      case `GET /api/v1/public/invitations/${token}`:
        return json({
          wedding: { name: `Release smoke ${sha.slice(0, 8)}` },
          guest: { name: "Unicode Guest Élodie" },
          rsvp: requests.some((request) => request.path.endsWith("/rsvp"))
            ? { attendance: "attending", partySize: 2 }
            : null,
        });
      case `PUT /api/v1/public/invitations/${token}/rsvp`:
        return json({ attendance: "attending", partySize: 2 });
      case `POST /api/v1/weddings/${weddingId}/guest-imports`:
        return json(
          { batchId, mappingVersion: 1, items: [{ id: rowId }] },
          201,
        );
      case `POST /api/v1/weddings/${weddingId}/guest-imports/${batchId}/commit`:
        return json({ created: 1, excluded: 0 });
      case `GET /api/v1/weddings/${weddingId}/guests/export.csv`:
        return new globalThis.Response("name\nCSV Guest Élodie\n", {
          status: 200,
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "cache-control": "no-store",
          },
        });
      default:
        throw new Error(`Unexpected request: ${key}`);
    }
  });
  return { fetcher, fixtureStore: store, store, records, requests };
}

const input = {
  webOrigin: origin,
  testEmail: "verified@example.test",
  testPassword: "private-test-password",
  verificationEmail: "delivered@resend.dev",
  sha,
};

describe("staging HTTP acceptance", () => {
  it("uses exact parameterized IDs for cleanup, never a broad table deletion", async () => {
    const queries = [];
    let outboxReads = 0;
    const client = {
      query: vi.fn(async (sql, params = []) => {
        queries.push({ sql, params });
        if (sql.includes("from auth_email_jobs")) {
          outboxReads += 1;
          const oldJob = "88888888-8888-4888-8888-888888888888";
          const newJob = "99999999-9999-4999-8999-999999999999";
          const ids = outboxReads === 1 ? [oldJob] : [newJob, oldJob];
          return { rows: ids.map((id) => ({ id })), rowCount: ids.length };
        }
        if (
          sql.trimStart().startsWith("select") &&
          sql.includes("from auth_accounts") &&
          !sql.includes("display_name")
        ) {
          return { rows: [], rowCount: 0 };
        }
        if (
          sql.includes("from guests where") ||
          sql.includes("from guest_import_batches where")
        ) {
          return { rows: [{ one: 1 }], rowCount: 1 };
        }
        if (
          sql.includes("from auth_accounts") &&
          sql.includes("display_name")
        ) {
          return {
            rows: [{ id: "77777777-7777-4777-8777-777777777777" }],
            rowCount: 1,
          };
        }
        if (
          sql.includes("from weddings") &&
          sql.includes("workspace_owner_user_id")
        ) {
          return { rows: [{ id: foreignWeddingId }], rowCount: 1 };
        }
        if (sql.includes("returning id"))
          return { rows: [{ id: params[0] }], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      }),
    };
    const store = createPostgresFixtureStore({
      client,
      foreignWeddingId,
      verificationEmail: input.verificationEmail,
    });
    const cursor = await store.snapshotOutbox(
      "verify_email",
      input.verificationEmail,
    );
    expect(
      await store.observeOutbox(
        "verify_email",
        input.verificationEmail,
        cursor,
      ),
    ).toBe(true);
    expect(
      await store.captureVerificationAccount(
        input.verificationEmail,
        `Release verify ${sha.slice(0, 8)}`,
        cursor,
      ),
    ).toBe("77777777-7777-4777-8777-777777777777");
    expect(
      await store.foreignWeddingId("66666666-6666-4666-8666-666666666666"),
    ).toBe(foreignWeddingId);
    await store.record(
      "verification_account",
      "77777777-7777-4777-8777-777777777777",
      { name: `Release verify ${sha.slice(0, 8)}` },
    );
    await store.record("wedding", weddingId, {
      ownerUserId: "66666666-6666-4666-8666-666666666666",
      name: `Release smoke ${sha.slice(0, 8)}`,
    });
    await store.record("guest", guestId);
    await store.record("import_batch", batchId);
    await store.record("invitation", token);
    await store.cleanup();
    const deletes = queries.filter(({ sql }) => /^\s*delete from /iu.test(sql));
    expect(deletes.map(({ sql }) => sql)).toEqual([
      expect.stringContaining("delete from weddings where id = $1"),
      expect.stringContaining(
        "delete from users where auth_provider = 'local'",
      ),
      expect.stringContaining("delete from auth_accounts where id = $1"),
    ]);
    expect(deletes.every(({ params }) => params.length >= 2)).toBe(true);
    expect(
      queries.some(({ sql }) =>
        /truncate|delete from weddings\s*$/iu.test(sql),
      ),
    ).toBe(false);
    expect(queries.some(({ sql }) => sql.includes("clock_timestamp()"))).toBe(
      false,
    );
  });

  it("checks auth, outbox, tenant scope, account-free RSVP, and bounded CSV", async () => {
    const context = fixture();
    const report = await runStagingHttpAcceptance(input, context);
    expect(report).toEqual({
      commitSha: sha,
      checks: [
        "verification_outbox",
        "reset_outbox",
        "verified_session",
        "tenant_isolation",
        "guest_rsvp",
        "csv_round_trip",
        "session_revoked",
        "scoped_cleanup",
      ],
      inboxDelivery: "waived",
    });
    expect(context.records).toContainEqual({ kind: "wedding", id: weddingId });
    expect(context.records).toContainEqual({ kind: "guest", id: guestId });
    expect(context.records).toContainEqual({
      kind: "import_batch",
      id: batchId,
    });
    expect(context.records).toContainEqual({ kind: "invitation", id: token });
    expect(context.store.cleanup).toHaveBeenCalledOnce();
    const publicRequests = context.requests.filter((item) =>
      item.path.includes("/public/"),
    );
    expect(publicRequests).toHaveLength(3);
    expect(publicRequests.every((item) => !item.headers?.Cookie)).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(
      /password|session-value|delivered@resend.dev|A{43}/,
    );
  });

  it("rejects maintenance without returning acceptance and still cleans up", async () => {
    const context = fixture({
      response: {
        "POST /api/v1/auth/sign-up": json({ mode: "maintenance" }, 503),
      },
    });
    await expect(runStagingHttpAcceptance(input, context)).rejects.toThrow();
    expect(context.store.cleanup).toHaveBeenCalledOnce();
  });

  it("rejects missing outbox, stale session, wrong-tenant access, and bad CSV", async () => {
    for (const overrides of [
      { store: { observeOutbox: vi.fn(async () => false) } },
      {
        response: {
          "GET /api/v1/auth/session": json({
            user: { email: "other@example.test" },
          }),
        },
      },
      {
        response: {
          [`GET /api/v1/weddings/${foreignWeddingId}/guests`]: json({
            items: [],
          }),
        },
      },
      {
        response: {
          [`GET /api/v1/weddings/${weddingId}/guests/export.csv`]:
            new globalThis.Response("wrong", { status: 200 }),
        },
      },
    ]) {
      const context = fixture(overrides);
      await expect(runStagingHttpAcceptance(input, context)).rejects.toThrow();
      expect(context.store.cleanup).toHaveBeenCalledOnce();
    }
  });

  it("rejects a still-valid cookie after sign-out and a failed scoped cleanup", async () => {
    const staleSession = fixture({
      response: {
        "GET /api/v1/auth/session": json({
          user: { id: "x", email: input.testEmail },
        }),
      },
    });
    await expect(
      runStagingHttpAcceptance(input, staleSession),
    ).rejects.toThrow();
    const cleanupFailure = fixture({
      store: {
        cleanup: vi.fn(async () => {
          throw new Error("cleanup failed");
        }),
      },
    });
    await expect(
      runStagingHttpAcceptance(input, cleanupFailure),
    ).rejects.toThrow("cleanup failed");
  });
});
