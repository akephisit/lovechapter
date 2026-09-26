import { randomBytes } from "node:crypto";

const shaPattern = /^[0-9a-f]{40}$/u;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const invitationPattern = /^[A-Za-z0-9_-]{43}$/u;

function requiredUuid(value, label) {
  if (typeof value !== "string" || !uuidPattern.test(value)) {
    throw new Error(`${label} is not a valid scoped fixture ID`);
  }
  return value;
}

function requiredStatus(response, status, check) {
  if (response.status !== status) {
    throw new Error(`${check} failed with HTTP ${response.status}`);
  }
  return response;
}

async function json(response, check) {
  try {
    return await response.json();
  } catch {
    throw new Error(`${check} returned invalid JSON`);
  }
}

function sessionCookie(response) {
  const header = response.headers.get("set-cookie") ?? "";
  const pair = header.split(";")[0];
  if (
    !/^__Host-lovechapter_session=[^;\s]+$/u.test(pair) ||
    !/;\s*HttpOnly(?:;|$)/iu.test(header) ||
    !/;\s*Secure(?:;|$)/iu.test(header)
  ) {
    throw new Error("Verified sign-in did not issue a secure session cookie");
  }
  return pair;
}

function requestFactory(origin, fetcher) {
  return async function request(
    path,
    { method = "GET", body, cookie, csv = false } = {},
  ) {
    const headers = {};
    if (method !== "GET" && method !== "HEAD") headers.Origin = origin;
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) {
      headers["content-type"] = csv ? "text/csv" : "application/json";
    }
    return fetcher(`${origin}/api${path}`, {
      method,
      headers,
      signal: globalThis.AbortSignal.timeout(20_000),
      ...(body === undefined
        ? {}
        : { body: csv ? body : JSON.stringify(body) }),
      redirect: "manual",
      cache: "no-store",
    });
  };
}

/** Exercise only synthetic staging records through the public web proxy. */
export async function runStagingHttpAcceptance(
  { webOrigin, testEmail, testPassword, verificationEmail, sha },
  { fetcher = globalThis.fetch, fixtureStore },
) {
  let origin;
  try {
    const parsed = new globalThis.URL(webOrigin);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname.endsWith(".workers.dev") ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error("invalid origin");
    }
    origin = parsed.origin;
  } catch {
    throw new Error("Staging web origin must be a workers.dev HTTPS origin");
  }
  if (
    !shaPattern.test(sha ?? "") ||
    !testEmail ||
    !testPassword ||
    !verificationEmail ||
    verificationEmail === testEmail ||
    !fixtureStore
  ) {
    throw new Error("Staging HTTP acceptance inputs are incomplete");
  }
  const request = requestFactory(origin, fetcher);
  const weddingName = `Release smoke ${sha.slice(0, 8)}`;
  const verificationName = `Release verify ${sha.slice(0, 8)}`;
  const guestName = "Unicode Guest Élodie";
  const csvName = "CSV Guest Élodie";
  const checks = [];
  try {
    const verificationCursor = await fixtureStore.snapshotOutbox(
      "verify_email",
      verificationEmail,
    );
    const resetCursor = await fixtureStore.snapshotOutbox(
      "reset_password",
      testEmail,
    );
    const signedUp = await request("/v1/auth/sign-up", {
      method: "POST",
      body: {
        displayName: verificationName,
        email: verificationEmail,
        password: randomBytes(24).toString("base64url"),
      },
    });
    requiredStatus(signedUp, 202, "verification sign-up");
    const verificationAccountId = requiredUuid(
      await fixtureStore.captureVerificationAccount(
        verificationEmail,
        verificationName,
        verificationCursor,
      ),
      "verification account",
    );
    await fixtureStore.record("verification_account", verificationAccountId, {
      name: verificationName,
    });
    requiredStatus(
      await request("/v1/auth/verification-email", {
        method: "POST",
        body: { email: verificationEmail },
      }),
      202,
      "verification request",
    );
    if (
      !(await fixtureStore.observeOutbox(
        "verify_email",
        verificationEmail,
        verificationCursor,
      ))
    ) {
      throw new Error("Verification outbox was not observed");
    }
    checks.push("verification_outbox");

    requiredStatus(
      await request("/v1/auth/forgot-password", {
        method: "POST",
        body: { email: testEmail },
      }),
      202,
      "password reset request",
    );
    if (
      !(await fixtureStore.observeOutbox(
        "reset_password",
        testEmail,
        resetCursor,
      ))
    ) {
      throw new Error("Reset outbox was not observed");
    }
    checks.push("reset_outbox");

    const signedIn = requiredStatus(
      await request("/v1/auth/sign-in", {
        method: "POST",
        body: { email: testEmail, password: testPassword },
      }),
      200,
      "verified sign-in",
    );
    const cookie = sessionCookie(signedIn);
    const session = await json(
      requiredStatus(
        await request("/v1/auth/session", { cookie }),
        200,
        "verified session",
      ),
      "verified session",
    );
    const ownerUserId = requiredUuid(session.user?.id, "verified user");
    if (session.user?.email !== testEmail) {
      throw new Error("Verified session belongs to the wrong account");
    }
    checks.push("verified_session");

    const wedding = await json(
      requiredStatus(
        await request("/v1/weddings", {
          method: "POST",
          cookie,
          body: { name: weddingName, timeZone: "UTC", locale: "en" },
        }),
        201,
        "synthetic wedding",
      ),
      "synthetic wedding",
    );
    const weddingId = requiredUuid(wedding.id, "wedding");
    await fixtureStore.record("wedding", weddingId, {
      ownerUserId,
      name: weddingName,
    });

    const foreignWeddingId = requiredUuid(
      await fixtureStore.foreignWeddingId(ownerUserId),
      "foreign wedding",
    );
    if (foreignWeddingId === weddingId) {
      throw new Error("Tenant isolation fixture points to the current wedding");
    }
    const foreign = await request(`/v1/weddings/${foreignWeddingId}/guests`, {
      cookie,
    });
    if (foreign.status !== 403 && foreign.status !== 404) {
      throw new Error("Cross-tenant guest read was not denied");
    }
    checks.push("tenant_isolation");

    const guest = await json(
      requiredStatus(
        await request(`/v1/weddings/${weddingId}/guests`, {
          method: "POST",
          cookie,
          body: { name: guestName, allowedPartySize: 2 },
        }),
        201,
        "synthetic guest",
      ),
      "synthetic guest",
    );
    const guestId = requiredUuid(guest.id, "guest");
    await fixtureStore.record("guest", guestId);
    const invitation = await json(
      requiredStatus(
        await request(
          `/v1/weddings/${weddingId}/guests/${guestId}/invitations`,
          { method: "POST", cookie, body: {} },
        ),
        201,
        "guest invitation",
      ),
      "guest invitation",
    );
    if (
      typeof invitation.token !== "string" ||
      !invitationPattern.test(invitation.token)
    ) {
      throw new Error("Invitation token was not valid");
    }
    await fixtureStore.record("invitation", invitation.token);
    const publicInvitation = await json(
      requiredStatus(
        await request(`/v1/public/invitations/${invitation.token}`),
        200,
        "public invitation",
      ),
      "public invitation",
    );
    if (
      publicInvitation.guest?.name !== guestName ||
      publicInvitation.wedding?.name !== weddingName
    ) {
      throw new Error(
        "Public invitation resolved to the wrong synthetic fixture",
      );
    }
    const rsvp = await json(
      requiredStatus(
        await request(`/v1/public/invitations/${invitation.token}/rsvp`, {
          method: "PUT",
          body: { attendance: "attending", partySize: 2 },
        }),
        200,
        "account-free RSVP",
      ),
      "account-free RSVP",
    );
    if (rsvp.attendance !== "attending" || rsvp.partySize !== 2) {
      throw new Error("RSVP state was not saved");
    }
    const savedRsvp = await json(
      requiredStatus(
        await request(`/v1/public/invitations/${invitation.token}`),
        200,
        "public RSVP readback",
      ),
      "public RSVP readback",
    );
    if (
      savedRsvp.rsvp?.attendance !== "attending" ||
      savedRsvp.rsvp?.partySize !== 2
    ) {
      throw new Error("RSVP readback did not match the submitted state");
    }
    checks.push("guest_rsvp");

    const csvPreview = await json(
      requiredStatus(
        await request(`/v1/weddings/${weddingId}/guest-imports`, {
          method: "POST",
          cookie,
          csv: true,
          body: `name\n${csvName}\n`,
        }),
        201,
        "CSV upload",
      ),
      "CSV upload",
    );
    const batchId = requiredUuid(csvPreview.batchId, "CSV batch");
    await fixtureStore.record("import_batch", batchId);
    const rowId = requiredUuid(csvPreview.items?.[0]?.id, "CSV row");
    if (csvPreview.items.length !== 1 || csvPreview.mappingVersion !== 1) {
      throw new Error("CSV preview is not the bounded synthetic fixture");
    }
    const committed = await json(
      requiredStatus(
        await request(
          `/v1/weddings/${weddingId}/guest-imports/${batchId}/commit`,
          {
            method: "POST",
            cookie,
            body: {
              expectedVersion: 1,
              includedRowIds: [rowId],
              createAnywayRowIds: [],
              idempotencyKey: sha,
            },
          },
        ),
        200,
        "CSV commit",
      ),
      "CSV commit",
    );
    if (committed.created !== 1 || committed.excluded !== 0) {
      throw new Error("CSV import did not create exactly one guest");
    }
    const exported = requiredStatus(
      await request(`/v1/weddings/${weddingId}/guests/export.csv`, { cookie }),
      200,
      "CSV export",
    );
    if (
      !exported.headers.get("content-type")?.startsWith("text/csv") ||
      exported.headers.get("cache-control") !== "no-store" ||
      !(await exported.text()).includes(csvName)
    ) {
      throw new Error("CSV export did not contain the scoped imported guest");
    }
    checks.push("csv_round_trip");

    requiredStatus(
      await request("/v1/auth/sign-out", {
        method: "POST",
        cookie,
        body: {},
      }),
      204,
      "sign-out",
    );
    requiredStatus(
      await request("/v1/auth/session", { cookie }),
      401,
      "revoked session",
    );
    checks.push("session_revoked");
  } finally {
    await fixtureStore.cleanup();
  }
  checks.push("scoped_cleanup");
  return { commitSha: sha, checks, inboxDelivery: "waived" };
}

/** A staging-only, direct-connection fixture store. The caller verifies its target first. */
export function createPostgresFixtureStore({
  client,
  foreignWeddingId,
  verificationEmail,
}) {
  requiredUuid(foreignWeddingId, "foreign wedding");
  if (!client?.query || !verificationEmail) {
    throw new Error(
      "Staging fixture store requires a database client and email",
    );
  }
  const recorded = new Map();
  async function outboxJobIds(purpose, email) {
    const result = await client.query(
      `select j.id from auth_email_jobs j
       join auth_accounts a on a.id = j.account_id
       where j.kind = $1 and a.email = $2
       order by j.created_at desc, j.id desc limit 101`,
      [purpose, email],
    );
    if (result.rows.length > 100) {
      throw new Error("Staging outbox probe exceeds its bounded history");
    }
    return result.rows.map((row) => requiredUuid(row.id, "outbox job"));
  }
  return {
    async snapshotOutbox(purpose, email) {
      if (!["verify_email", "reset_password"].includes(purpose) || !email) {
        throw new Error("Invalid outbox observation scope");
      }
      let accountAbsent = false;
      if (purpose === "verify_email") {
        const account = await client.query(
          "select id from auth_accounts where email = $1 limit 1",
          [email],
        );
        if (account.rows.length !== 0) {
          throw new Error("Verification test address already has an account");
        }
        accountAbsent = true;
      }
      return {
        purpose,
        email,
        accountAbsent,
        existingJobIds: await outboxJobIds(purpose, email),
      };
    },
    async observeOutbox(purpose, email, cursor) {
      if (
        !["verify_email", "reset_password"].includes(purpose) ||
        !email ||
        cursor?.purpose !== purpose ||
        cursor.email !== email ||
        !Array.isArray(cursor.existingJobIds)
      ) {
        throw new Error("Invalid outbox observation scope");
      }
      const previous = new Set(cursor.existingJobIds);
      return (await outboxJobIds(purpose, email)).some(
        (id) => !previous.has(id),
      );
    },
    async captureVerificationAccount(email, displayName, cursor) {
      if (
        email !== verificationEmail ||
        !displayName.startsWith("Release verify ") ||
        cursor?.purpose !== "verify_email" ||
        cursor.email !== email ||
        cursor.accountAbsent !== true
      ) {
        throw new Error("Verification account scope is invalid");
      }
      const result = await client.query(
        `select a.id from auth_accounts a
         join users u on u.auth_provider = 'local' and u.auth_subject = a.id::text
         where a.email = $1 and u.display_name = $2
           and a.email_verified_at is null
         limit 2`,
        [email, displayName],
      );
      if (result.rows.length !== 1) {
        throw new Error("Synthetic verification account is not unique");
      }
      return requiredUuid(result.rows[0].id, "verification account");
    },
    async foreignWeddingId(ownerUserId) {
      requiredUuid(ownerUserId, "verified user");
      const result = await client.query(
        `select id from weddings
         where id = $1 and workspace_owner_user_id <> $2
         limit 1`,
        [foreignWeddingId, ownerUserId],
      );
      if (result.rows.length !== 1) {
        throw new Error("Foreign-tenant staging fixture is unavailable");
      }
      return requiredUuid(result.rows[0].id, "foreign wedding");
    },
    async record(kind, id, metadata = {}) {
      if (
        ![
          "verification_account",
          "wedding",
          "guest",
          "import_batch",
          "invitation",
        ].includes(kind) ||
        recorded.has(kind) ||
        (kind === "invitation"
          ? !invitationPattern.test(id)
          : !uuidPattern.test(id))
      ) {
        throw new Error("Scoped staging fixture record is invalid");
      }
      if (
        (kind === "wedding" &&
          (!uuidPattern.test(metadata.ownerUserId ?? "") ||
            !metadata.name?.startsWith("Release smoke "))) ||
        (kind === "verification_account" &&
          !metadata.name?.startsWith("Release verify "))
      ) {
        throw new Error("Synthetic fixture ownership metadata is invalid");
      }
      recorded.set(kind, { id, metadata });
    },
    async cleanup() {
      if (!recorded.has("wedding") && !recorded.has("verification_account")) {
        return;
      }
      try {
        await client.query("begin");
        const wedding = recorded.get("wedding");
        if (wedding) {
          for (const [kind, table] of [
            ["guest", "guests"],
            ["import_batch", "guest_import_batches"],
          ]) {
            const item = recorded.get(kind);
            if (!item) continue;
            const scoped = await client.query(
              `select 1 as one from ${table} where wedding_id = $1 and id = $2 limit 1`,
              [wedding.id, item.id],
            );
            if (scoped.rows.length !== 1) {
              throw new Error("Recorded fixture is outside its wedding scope");
            }
          }
          const removed = await client.query(
            `delete from weddings where id = $1 and name = $2
               and created_by_user_id = $3 returning id`,
            [wedding.id, wedding.metadata.name, wedding.metadata.ownerUserId],
          );
          if (removed.rowCount !== 1) {
            throw new Error("Synthetic wedding cleanup did not remove one row");
          }
        }
        const account = recorded.get("verification_account");
        if (account) {
          const removedUser = await client.query(
            `delete from users where auth_provider = 'local'
               and auth_subject = $1 and display_name = $2 and email = $3
               and not exists (select 1 from weddings where created_by_user_id = users.id)
             returning id`,
            [account.id, account.metadata.name, verificationEmail],
          );
          if (removedUser.rowCount !== 1) {
            throw new Error("Synthetic user cleanup did not remove one row");
          }
          const removedAccount = await client.query(
            `delete from auth_accounts where id = $1 and email = $2
               and email_verified_at is null returning id`,
            [account.id, verificationEmail],
          );
          if (removedAccount.rowCount !== 1) {
            throw new Error(
              "Synthetic auth account cleanup did not remove one row",
            );
          }
        }
        await client.query("commit");
        recorded.clear();
      } catch {
        await client.query("rollback");
        throw new Error("Scoped staging fixture cleanup failed");
      }
    },
  };
}
