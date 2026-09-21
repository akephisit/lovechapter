# Clerk Production Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add open-registration Clerk authentication with Google and email OTP, local display-name onboarding, and server-verified bearer sessions without changing LoveChapter's wedding authorization model or public guest flow.

**Architecture:** Clerk manages browser authentication and issues short-lived session tokens; the web app sends those tokens to the separate Elysia Worker, where `@clerk/backend` verifies them networklessly. LoveChapter maps Clerk `sub` to its existing local user table, stores onboarding/profile state locally, and continues to authorize every wedding operation from PostgreSQL membership data.

**Tech Stack:** Next.js 16.3.5, React 19.3.0, vinext 1.0.0-beta.10, Clerk Next.js 7.9.4, Clerk Backend 3.18.1, Elysia 2.0.0-beta.16, Cloudflare Workers, Drizzle ORM 0.45.3, Neon PostgreSQL through Hyperdrive, Vitest 5.0.1

**Spec:** `docs/superpowers/specs/2026-09-21-clerk-production-authentication-design.md`

## Global Constraints

- Preserve the locked Next.js/vinext, Elysia 2, Cloudflare Workers, Neon, Hyperdrive, Drizzle, and `pg` architecture.
- Use Clerk only for authentication/session identity; LoveChapter PostgreSQL remains the source of truth for membership, roles, ownership, and billing ownership.
- Registration is open; initial methods are Google and email verification code. Do not add passwords, phone/SMS, Apple, passkeys, mandatory MFA, or Clerk Organizations.
- Guests continue to access `/i/{invitationToken}` without a Clerk account or Clerk availability.
- Use one Unicode-capable `displayName`; do not impose first-name/last-name semantics.
- Accept only Clerk `session_token` bearer tokens and verify `authorizedParties` against the exact `PUBLIC_WEB_ORIGIN`.
- Never log or persist session tokens, authorization headers, primary email claims, or full claim payloads.
- Keep `AUTH_MODE=disabled` fail-closed, preserve explicit development identity, and never fall back from `clerk` to `development`.
- Do not hardcode or configure `lovechapter.tech`; use configurable `*.workers.dev` origins.
- Keep queries parameterized, explicitly projected, bounded, and tenant-scoped; do not add an onboarding index.
- Keep technical names, source, migrations, and documentation in English; current product copy uses English as the fallback language.

## Review Focus

- Missing, malformed, expired, wrong-authorized-party, or missing-email Clerk sessions must return `401` without synchronizing a local user; Task 4 tests every class through the injected verifier boundary.
- An authenticated but incomplete Clerk user must be able to call `GET/PATCH /v1/me` and must receive `403 onboarding_required` from wedding operations; Task 3 and Task 4 pin both domain and HTTP behavior.
- Existing development identities with a null onboarding timestamp must remain locally usable, while Clerk identities remain incomplete until profile update; Task 2 tests both paths.
- Public invitation and RSVP routes must work without initializing Clerk or requesting a bearer token; Task 5 and Task 6 include regression tests for the API client and public route boundary.
- A session that expires after workspace data loaded must clear protected UI and sign out instead of leaving stale tenant data visible; Task 6 exercises the established-session `401` path.

---

### Task 1: Pin Clerk SDKs and prove the vinext boundary

**Files:**

- Modify: `apps/web/package.json`
- Modify: `apps/api/package.json`
- Modify: `package-lock.json`
- Create: `apps/web/lib/clerk-config.ts`
- Create: `apps/web/lib/clerk-config.test.ts`
- Create: `apps/web/components/clerk-app-provider.tsx`
- Create: `apps/web/app/(authenticated)/layout.tsx`
- Move: `apps/web/app/page.tsx` → `apps/web/app/(authenticated)/page.tsx`
- Modify: `apps/web/vite.config.ts`
- Modify: `apps/web/next.config.ts`
- Modify: `apps/web/.env.local.example`

**Interfaces:**

- Consumes: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` from the web build environment.
- Produces: `parseClerkPublishableKey(value: string | undefined): string`, a client-only `ClerkAppProvider`, pinned Clerk packages, and a Clerk-wrapped route group that excludes `/i/*`.

- [ ] **Step 1: Write the failing publishable-key configuration tests**

Create `apps/web/lib/clerk-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseClerkPublishableKey } from "./clerk-config";

describe("Clerk publishable-key configuration", () => {
  it("accepts and trims a Clerk test or live publishable key", () => {
    expect(parseClerkPublishableKey("  pk_test_example  ")).toBe(
      "pk_test_example",
    );
    expect(parseClerkPublishableKey("pk_live_example")).toBe("pk_live_example");
  });

  it.each([undefined, "", "sk_test_secret", "clerk-key"])(
    "rejects an absent or non-publishable value: %s",
    (value) => {
      expect(() => parseClerkPublishableKey(value)).toThrow(
        "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must be a Clerk publishable key",
      );
    },
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- --run apps/web/lib/clerk-config.test.ts
```

Expected: FAIL because `apps/web/lib/clerk-config.ts` does not exist.

- [ ] **Step 3: Install exact Clerk packages**

Run:

```bash
npm install --workspace @lovechapter/web @clerk/nextjs@7.9.4
npm install --workspace @lovechapter/api @clerk/backend@3.18.1
```

Expected: `apps/web/package.json`, `apps/api/package.json`, and
`package-lock.json` record exact compatible versions without replacing the
locked frameworks.

- [ ] **Step 4: Implement build-time Clerk configuration**

Create `apps/web/lib/clerk-config.ts`:

```ts
export function parseClerkPublishableKey(value: string | undefined): string {
  const key = value?.trim();
  if (!key || !/^pk_(test|live)_/.test(key)) {
    throw new Error(
      "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY must be a Clerk publishable key",
    );
  }
  return key;
}
```

Validate and explicitly define the key in `apps/web/vite.config.ts` beside the
API origin:

```ts
import { parseClerkPublishableKey } from "./lib/clerk-config.ts";

const clerkPublishableKey = parseClerkPublishableKey(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);

define: {
  "process.env.NEXT_PUBLIC_API_ORIGIN": JSON.stringify(publicApiOrigin),
  "process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY":
    JSON.stringify(clerkPublishableKey),
},
```

Call the same parser from `apps/web/next.config.ts`. Add a non-secret example
value to `apps/web/.env.local.example`:

```dotenv
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_replace_with_clerk_development_key
```

- [ ] **Step 5: Add the authenticated-only Clerk provider boundary**

Create `apps/web/components/clerk-app-provider.tsx`:

```tsx
"use client";

import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";

import { parseClerkPublishableKey } from "../lib/clerk-config";

const publishableKey = parseClerkPublishableKey(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);

export function ClerkAppProvider({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider
      publishableKey={publishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/"
      signUpFallbackRedirectUrl="/"
      afterSignOutUrl="/sign-in"
    >
      {children}
    </ClerkProvider>
  );
}
```

Move the current root page to `apps/web/app/(authenticated)/page.tsx` without
changing its URL, and create `apps/web/app/(authenticated)/layout.tsx`:

```tsx
import type { ReactNode } from "react";

import { ClerkAppProvider } from "../../components/clerk-app-provider";

export default function AuthenticatedLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <ClerkAppProvider>{children}</ClerkAppProvider>;
}
```

Keep `apps/web/app/i/[invitationToken]/page.tsx` outside this route group so a
guest route never initializes Clerk.

- [ ] **Step 6: Run focused tests and compatibility builds**

Run:

```bash
npm test -- --run apps/web/lib/clerk-config.test.ts
npm run typecheck --workspace @lovechapter/web
NEXT_PUBLIC_API_ORIGIN=https://api.example.workers.dev \
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA \
npm run build:next --workspace @lovechapter/web
NEXT_PUBLIC_API_ORIGIN=https://api.example.workers.dev \
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA \
npm run build --workspace @lovechapter/web
NEXT_PUBLIC_API_ORIGIN=https://api.example.workers.dev \
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA \
npm exec --workspace @lovechapter/web -- vinext check
```

Expected: test, type-check, native Next build, vinext build, and compatibility
check pass; `/i/:invitationToken` remains a route outside the Clerk layout.

If and only if the failure is reproduced inside `@clerk/nextjs` under vinext,
replace the web dependency with exact `@clerk/react@6.16.1`, replace imports in
`clerk-app-provider.tsx` with `@clerk/react`, and rerun the same commands. Record
the exact failure and fallback in `docs/DECISIONS.md`; do not change the backend
token design or another locked framework.

- [ ] **Step 7: Commit the compatibility boundary**

```bash
git add apps/web apps/api/package.json package-lock.json docs/DECISIONS.md
git commit -m "build: add Clerk compatibility boundary"
```

Do not stage `docs/DECISIONS.md` when no fallback entry was needed.

---

### Task 2: Persist local onboarding state without overwriting profile data

**Files:**

- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/domain/src/ports.ts`
- Modify: `packages/domain/src/testing/in-memory-repository.ts`
- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/schema.test.ts`
- Modify: `packages/database/src/queries.ts`
- Modify: `packages/database/src/query-contract.test.ts`
- Modify: `packages/database/src/repository.ts`
- Modify: `packages/database/src/repository.test.ts`
- Create: `packages/database/drizzle/0001_add_user_onboarding.sql`
- Create: `packages/database/drizzle/meta/0001_snapshot.json`
- Modify: `packages/database/drizzle/meta/_journal.json`
- Modify: `packages/domain/src/service.test.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/web/components/couple-workspace.test.tsx`

**Interfaces:**

- Consumes: verified `Principal` records and the existing `(authProvider, authSubject)` identity key.
- Produces: `AuthenticatedUser.onboardingComplete`, `UpdateProfileInput`, `LoveChapterRepository.updateUserProfile(userId, input)`, additive onboarding migration, and SQL builders that preserve user-chosen names.

- [ ] **Step 1: Write failing contract, schema, and query tests**

Add these expectations to the existing tests:

```ts
// packages/database/src/schema.test.ts
const userConfig = getTableConfig(users);
expect(
  userConfig.columns.find((column) => column.name === "onboarding_completed_at")
    ?.notNull,
).toBe(false);
expect(userConfig.indexes.map((index) => index.config.name)).not.toContain(
  "users_onboarding_completed_idx",
);
```

```ts
// packages/database/src/query-contract.test.ts
const sync = dialect.sqlToQuery(
  buildSyncUserQuery({
    id: userId,
    provider: "clerk",
    subject: "user_clerk",
    displayName: "couple@example.test",
    email: "couple@example.test",
  }),
);
expect(sync.sql).toMatch(/do update set\s+"email" = excluded\."email"/i);
expect(sync.sql).not.toMatch(/do update set[\s\S]*"display_name" =/i);

const update = dialect.sqlToQuery(
  buildUpdateUserProfileQuery({ userId, displayName: "คู่รัก" }),
);
expect(update.sql).toMatch(/where "users"\."id" = \$\d+/i);
expect(update.sql).toMatch(/"onboarding_completed_at" = now\(\)/i);
expect(update.params).toEqual(expect.arrayContaining([userId, "คู่รัก"]));
```

Add repository tests proving a Clerk sync row maps to
`onboardingComplete: false`, a development row maps to `true` even with a null
timestamp, and `updateUserProfile` returns `onboardingComplete: true` in one
statement.

- [ ] **Step 2: Run the focused database tests and verify RED**

Run:

```bash
npm test -- --run packages/database/src/schema.test.ts packages/database/src/query-contract.test.ts packages/database/src/repository.test.ts
```

Expected: FAIL because the contract field, schema column, update builder, and
repository method do not exist.

- [ ] **Step 3: Extend shared contracts and the repository port**

In `packages/contracts/src/index.ts`:

```ts
export type AuthenticatedUser = {
  id: string;
  displayName: string;
  email?: string;
  onboardingComplete: boolean;
};

export type UpdateProfileInput = {
  displayName: string;
};
```

In `packages/domain/src/ports.ts` add:

```ts
updateUserProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<AuthenticatedUser>;
```

Update every existing `AuthenticatedUser` fixture in the files listed above.
Development fixtures use `onboardingComplete: true`; the new Clerk fixtures use
`false` until profile update.

- [ ] **Step 4: Add the nullable schema field and generate the named migration**

Add to `users` in `packages/database/src/schema.ts`:

```ts
onboardingCompletedAt: timestamp("onboarding_completed_at", {
  withTimezone: true,
  mode: "string",
}),
```

Run:

```bash
npm run db:generate --workspace @lovechapter/database -- --name add_user_onboarding
```

Expected: Drizzle creates `0001_add_user_onboarding.sql`, updates the journal,
and creates `0001_snapshot.json`; SQL contains one nullable timestamp column and
no index or table rewrite default.

- [ ] **Step 5: Implement parameterized sync and profile-update SQL**

Change `buildSyncUserQuery` so the conflict branch updates only email and
`updated_at`, and return `onboarding_completed_at`:

```ts
on conflict ("auth_provider","auth_subject") do update set
  "email" = excluded."email",
  "updated_at" = now()
returning
  ${users.id} as "id",
  ${users.displayName} as "display_name",
  ${users.email} as "email",
  ${users.onboardingCompletedAt} as "onboarding_completed_at"
```

Add:

```ts
export function buildUpdateUserProfileQuery(input: {
  userId: string;
  displayName: string;
}): SQL {
  return sql`update ${users}
    set ${users.displayName} = ${input.displayName},
        ${users.onboardingCompletedAt} = now(),
        ${users.updatedAt} = now()
    where ${users.id} = ${input.userId}
    returning
      ${users.id} as "id",
      ${users.displayName} as "display_name",
      ${users.email} as "email",
      ${users.onboardingCompletedAt} as "onboarding_completed_at"`;
}
```

- [ ] **Step 6: Implement PostgreSQL and in-memory mappings**

Extend `UserRow` with `onboarding_completed_at`. Map users through one helper:

```ts
function toAuthenticatedUser(
  row: UserRow,
  developmentIdentity = false,
): AuthenticatedUser {
  const user = {
    id: row.id,
    displayName: row.display_name,
    onboardingComplete:
      developmentIdentity || row.onboarding_completed_at !== null,
  };
  return row.email ? { ...user, email: row.email } : user;
}
```

`syncUser` passes `principal.provider === "development"`; `updateUserProfile`
executes `buildUpdateUserProfileQuery`, requires one returned row, and maps it
with onboarding complete.

Update the in-memory repository so first-time development users are complete,
first-time Clerk users are incomplete, a repeated sync updates only a supplied
email, and `updateUserProfile` changes the display name and marks the user
complete.

- [ ] **Step 7: Run database and all-workspace type checks**

Run:

```bash
npm test -- --run packages/database/src/schema.test.ts packages/database/src/query-contract.test.ts packages/database/src/repository.test.ts
npm run db:check --workspace @lovechapter/database
npm run typecheck
```

Expected: focused tests, Drizzle consistency check, and all workspace type
checks pass. Inspect `0001_add_user_onboarding.sql` and confirm it contains no
index and no non-null default.

- [ ] **Step 8: Commit the local profile persistence layer**

```bash
git add packages apps/api/src/app.test.ts apps/web/components/couple-workspace.test.tsx
git commit -m "feat: persist user onboarding state"
```

---

### Task 3: Enforce onboarding in framework-independent domain logic

**Files:**

- Modify: `packages/domain/src/errors.ts`
- Modify: `packages/domain/src/service.ts`
- Modify: `packages/domain/src/service.test.ts`

**Interfaces:**

- Consumes: `AuthenticatedUser.onboardingComplete` and `LoveChapterRepository.updateUserProfile` from Task 2.
- Produces: `OnboardingRequiredError`, `LoveChapterService.updateMyProfile(input)`, and server-side onboarding enforcement for all protected workspace operations.

- [ ] **Step 1: Write failing onboarding domain tests**

Add tests that use a Clerk principal:

```ts
const clerkPrincipal: Principal = {
  provider: "clerk",
  subject: "user_clerk_1",
  displayName: "couple@example.test",
  email: "couple@example.test",
};

it("allows profile setup but blocks workspace operations before onboarding", async () => {
  const repository = new InMemoryLoveChapterRepository();
  const clerkService = service(repository, clerkPrincipal);

  await expect(clerkService.getMe()).resolves.toMatchObject({
    onboardingComplete: false,
  });
  await expect(
    clerkService.createWedding({
      name: "Mali & Arun",
      timeZone: "UTC",
      locale: "en",
    }),
  ).rejects.toBeInstanceOf(OnboardingRequiredError);

  await expect(
    clerkService.updateMyProfile({ displayName: "  มะลิ & Arun  " }),
  ).resolves.toMatchObject({
    displayName: "มะลิ & Arun",
    onboardingComplete: true,
  });
});

it.each(["", "   ", "a".repeat(121)])(
  "rejects an invalid display name",
  async (displayName) => {
    await expect(
      service(
        new InMemoryLoveChapterRepository(),
        clerkPrincipal,
      ).updateMyProfile({ displayName }),
    ).rejects.toBeInstanceOf(DomainValidationError);
  },
);
```

Keep the existing complete development flow as the regression proving a null
database timestamp does not block local development.

- [ ] **Step 2: Run the domain tests and verify RED**

Run:

```bash
npm test -- --run packages/domain/src/service.test.ts
```

Expected: FAIL because the new error and profile method do not exist and
workspace methods do not enforce onboarding.

- [ ] **Step 3: Implement the domain error and service methods**

Add to `errors.ts`:

```ts
export class OnboardingRequiredError extends Error {
  override readonly name = "OnboardingRequiredError";
}
```

Add to `LoveChapterService`:

```ts
async updateMyProfile(input: UpdateProfileInput): Promise<AuthenticatedUser> {
  const user = await this.requireUser();
  const displayName = input.displayName.trim();
  if (!displayName || Array.from(displayName).length > 120) {
    throw new DomainValidationError("Display name must be 1–120 characters");
  }
  return this.repository.updateUserProfile(user.id, { displayName });
}

private async requireOnboardedUser(): Promise<AuthenticatedUser> {
  const user = await this.requireUser();
  if (!user.onboardingComplete) {
    throw new OnboardingRequiredError("Profile setup required");
  }
  return user;
}
```

Use `requireOnboardedUser()` in `createWedding`, `listWeddings`, `addGuest`,
`listGuests`, and `createInvitation`. Keep `getMe`, `updateMyProfile`,
`getPublicInvitation`, and `submitRsvp` outside that gate.

- [ ] **Step 4: Run domain tests and type-check**

Run:

```bash
npm test -- --run packages/domain/src/service.test.ts
npm run typecheck --workspace @lovechapter/domain
```

Expected: domain tests pass, including Unicode onboarding, invalid input,
incomplete direct access, and the existing RSVP flow.

- [ ] **Step 5: Commit domain onboarding enforcement**

```bash
git add packages/domain
git commit -m "feat: enforce profile onboarding"
```

---

### Task 4: Verify Clerk sessions in the API Worker

**Files:**

- Create: `apps/api/src/clerk-identity.ts`
- Create: `apps/api/src/clerk-identity.test.ts`
- Create: `apps/api/src/api-identity.ts`
- Create: `apps/api/src/api-identity.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/api/.dev.vars.example`

**Interfaces:**

- Consumes: `IdentityProvider`, `Principal`, `UpdateProfileInput`, `OnboardingRequiredError`, `CLERK_PUBLISHABLE_KEY`, `CLERK_JWT_KEY`, and `PUBLIC_WEB_ORIGIN`.
- Produces: `createClerkIdentityProvider(config, authenticate?)`, `createApiIdentityProvider(environment, authenticate?)`, `PATCH /v1/me`, stable `403 onboarding_required`, and CORS support for bearer requests.

- [ ] **Step 1: Write failing Clerk identity tests through an injectable verifier**

Define test cases around this boundary:

```ts
export type VerifiedClerkSession = {
  subject: string;
  primaryEmail: string;
};

export type AuthenticateClerkSession = (
  request: Request,
  config: ClerkIdentityConfig,
) => Promise<VerifiedClerkSession | null>;
```

The tests must assert:

```ts
it("maps a verified Clerk session to the domain principal", async () => {
  const provider = createClerkIdentityProvider(config, async () => ({
    subject: "user_123",
    primaryEmail: "Couple@Example.Test",
  }));
  await expect(provider.resolve(request)).resolves.toEqual({
    provider: "clerk",
    subject: "user_123",
    displayName: "couple@example.test",
    email: "couple@example.test",
  });
});

it.each(["missing", "malformed", "expired", "wrong-party", "missing-email"])(
  "fails closed for %s sessions",
  async () => {
    const provider = createClerkIdentityProvider(config, async () => null);
    await expect(provider.resolve(request)).resolves.toBeNull();
  },
);
```

Add a production-adapter test with a fake Clerk client that asserts
`acceptsToken: "session_token"`, `jwtKey`, and
`authorizedParties: [publicWebOrigin]` are passed to `authenticateRequest`.

- [ ] **Step 2: Write failing API mode, onboarding, and CORS tests**

Add tests proving:

- `AUTH_MODE=clerk` uses the Clerk provider;
- missing Clerk configuration throws a clear startup configuration error;
- `AUTH_MODE=disabled` and incomplete development configuration still fail
  closed;
- missing, malformed, expired, wrong-party, and missing-email session cases each
  return `401` through an injected verifier, and the repository `syncUser` spy
  remains untouched;
- `PATCH /v1/me` accepts `{ displayName: "คู่รัก" }` and returns onboarding
  complete;
- an incomplete Clerk user receives `403 onboarding_required` from
  `POST /v1/weddings`;
- `PUBLIC_WEB_ORIGIN` is normalized to a bare HTTP(S) origin and rejects paths,
  credentials, queries, and fragments;
- preflight from the configured origin includes
  `Access-Control-Allow-Headers: Content-Type, Authorization` and
  `Access-Control-Allow-Methods: GET,POST,PUT,PATCH,OPTIONS`;
- a rejected origin receives no CORS authorization.

- [ ] **Step 3: Run focused API tests and verify RED**

Run:

```bash
npm test -- --run apps/api/src/clerk-identity.test.ts apps/api/src/api-identity.test.ts apps/api/src/app.test.ts
```

Expected: FAIL because the Clerk provider, API factory, profile route, error
mapping, and Authorization CORS header do not exist.

- [ ] **Step 4: Implement the Clerk identity adapter**

`createClerkIdentityProvider` validates non-empty configuration, delegates
cryptographic/session verification to `AuthenticateClerkSession`, normalizes
the verified primary email to lowercase, and maps no unverified data.

The production verifier creates `@clerk/backend`'s client and calls:

```ts
const state = await clerkClient.authenticateRequest(request, {
  acceptsToken: "session_token",
  jwtKey: config.jwtKey,
  authorizedParties: [config.publicWebOrigin],
});
const auth = state.toAuth();
const primaryEmail = auth.sessionClaims.primaryEmail;
if (!auth.userId || typeof primaryEmail !== "string" || !primaryEmail.trim()) {
  return null;
}
return { subject: auth.userId, primaryEmail };
```

Catch Clerk verification failures and return `null`; do not log the thrown
object because it may carry request/authentication details.

- [ ] **Step 5: Implement the explicit API identity mode factory**

`apps/api/src/api-identity.ts` switches only on exact modes:

```ts
export function createApiIdentityProvider(
  environment: ApiIdentityEnvironment,
  authenticate?: AuthenticateClerkSession,
): IdentityProvider {
  if (environment.AUTH_MODE === "clerk") {
    const publicWebOrigin = parsePublicWebOrigin(environment.PUBLIC_WEB_ORIGIN);
    return createClerkIdentityProvider(
      {
        publishableKey: required(
          environment.CLERK_PUBLISHABLE_KEY,
          "CLERK_PUBLISHABLE_KEY",
        ),
        jwtKey: required(environment.CLERK_JWT_KEY, "CLERK_JWT_KEY"),
        publicWebOrigin,
      },
      authenticate,
    );
  }
  return createConfiguredIdentityProvider(environment);
}
```

Unknown modes remain unauthenticated rather than being interpreted as
development. Implement and export `parsePublicWebOrigin` in this module using
`new URL()`: permit only `http:` or `https:`, reject credentials, non-root
paths, queries, and fragments, and return `url.origin` so CORS and Clerk use the
same canonical value. In `index.ts`, parse once and pass the canonical origin to
`createApiIdentityProvider`, `createApiApp`, and `LoveChapterService`.

- [ ] **Step 6: Add profile HTTP behavior and onboarding error mapping**

Add the Elysia schema:

```ts
const profileInput = t.Object(
  { displayName: t.String({ minLength: 1, maxLength: 120 }) },
  { additionalProperties: false },
);
```

Add:

```ts
.patch("/v1/me", { body: profileInput }, ({ body, request }) =>
  dependencies.run(request, (service) => service.updateMyProfile(body)),
)
```

Map `OnboardingRequiredError` to:

```ts
return status(403, errorBody("onboarding_required", "Profile setup required"));
```

Change CORS allowed headers to `Content-Type, Authorization` and allowed methods
to `GET,POST,PUT,PATCH,OPTIONS`. Update
`apps/api/src/index.ts` to construct identity through
`createApiIdentityProvider(env)`.

- [ ] **Step 7: Update safe configuration examples and validate the API**

Add commented Clerk-mode examples to `.dev.vars.example` while keeping
development identity active by default:

```dotenv
# For Clerk mode, replace AUTH_MODE above and provide real local values:
# AUTH_MODE=clerk
# CLERK_PUBLISHABLE_KEY=pk_test_replace_me
# CLERK_JWT_KEY=-----BEGIN PUBLIC KEY-----...-----END PUBLIC KEY-----
```

Run:

```bash
npm test -- --run apps/api/src/clerk-identity.test.ts apps/api/src/api-identity.test.ts apps/api/src/app.test.ts
npm run typecheck --workspace @lovechapter/api
npm run build --workspace @lovechapter/api
```

Expected: all focused tests, type-check, and Wrangler dry-run pass without real
Clerk credentials because the committed Worker default remains
`AUTH_MODE=disabled`.

- [ ] **Step 8: Commit API authentication**

```bash
git add apps/api
git commit -m "feat: verify Clerk sessions in API"
```

---

### Task 5: Make the web API client authentication-aware

**Files:**

- Modify: `apps/web/lib/api-client.ts`
- Create: `apps/web/lib/api-client.test.ts`
- Modify: `apps/web/components/public-rsvp.tsx`

**Interfaces:**

- Consumes: Clerk-compatible `TokenProvider = () => Promise<string | null>` and shared profile contracts.
- Produces: `createLoveChapterApi(getToken, onAuthenticationRequired)`,
  `loveChapterPublicApi`, protected bearer requests, centralized `401` handling,
  and token-free public invitation requests.

- [ ] **Step 1: Write failing API-client tests**

Create deterministic fetch tests:

```ts
it("adds the Clerk bearer token to protected requests", async () => {
  const getToken = vi.fn(async () => "session-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse(userFixture)),
  );

  await createLoveChapterApi(getToken, vi.fn()).getMe();

  expect(getToken).toHaveBeenCalledOnce();
  expect(fetch).toHaveBeenCalledWith(
    expect.any(URL),
    expect.objectContaining({
      headers: expect.objectContaining({}),
    }),
  );
  const headers = new Headers(vi.mocked(fetch).mock.calls[0]?.[1]?.headers);
  expect(headers.get("authorization")).toBe("Bearer session-token");
});

it("does not fetch a protected endpoint when no session token exists", async () => {
  const fetchMock = vi.fn();
  const onAuthenticationRequired = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  await expect(
    createLoveChapterApi(async () => null, onAuthenticationRequired).getMe(),
  ).rejects.toMatchObject({ status: 401, code: "authentication_required" });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(onAuthenticationRequired).toHaveBeenCalledOnce();
});

it("notifies the auth boundary when an established request receives 401", async () => {
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
  ).rejects.toMatchObject({ status: 401 });
  expect(onAuthenticationRequired).toHaveBeenCalledOnce();
});

it("never asks for a token on the public invitation path", async () => {
  const getToken = vi.fn(async () => "must-not-be-used");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => jsonResponse(invitationFixture)),
  );
  await loveChapterPublicApi.getInvitation("safe-token");
  expect(getToken).not.toHaveBeenCalled();
  const headers = new Headers(vi.mocked(fetch).mock.calls[0]?.[1]?.headers);
  expect(headers.has("authorization")).toBe(false);
});
```

Also test `PATCH /v1/me` method/body and verify a parsed API `401` retains its
stable error code.

- [ ] **Step 2: Run the client tests and verify RED**

Run:

```bash
npm test -- --run apps/web/lib/api-client.test.ts
```

Expected: FAIL because the protected/public factories do not exist.

- [ ] **Step 3: Implement separate protected and public clients**

Add:

```ts
export type TokenProvider = () => Promise<string | null>;
export type AuthenticationRequiredHandler = () => void | Promise<void>;

async function authenticatedRequest<T>(
  getToken: TokenProvider,
  onAuthenticationRequired: AuthenticationRequiredHandler,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getToken();
  if (!token) {
    await onAuthenticationRequired();
    throw new ApiError(
      "Authentication required",
      401,
      "authentication_required",
    );
  }
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  try {
    return await apiRequest<T>(path, { ...init, headers });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      await onAuthenticationRequired();
    }
    throw error;
  }
}
```

Export `createLoveChapterApi(getToken, onAuthenticationRequired)` with `getMe`,
`updateMyProfile`, wedding, guest, and invitation-management methods. Route
every protected operation through the same callback so expiry after the
workspace has loaded cannot leave protected tenant data visible. Export
`loveChapterPublicApi` with only `getInvitation` and `submitRsvp`. Make
`PublicRsvp` default to the public client.

- [ ] **Step 4: Run focused tests, public RSVP regression, and web type-check**

Run:

```bash
npm test -- --run apps/web/lib/api-client.test.ts apps/web/components/public-rsvp.test.tsx
npm run typecheck --workspace @lovechapter/web
```

Expected: token injection, missing-session short circuit, established-session
`401` callback, public no-token behavior, RSVP regression, and type-check all
pass.

- [ ] **Step 5: Commit the API client boundary**

```bash
git add apps/web/lib apps/web/components/public-rsvp.tsx
git commit -m "feat: authenticate protected web requests"
```

---

### Task 6: Build sign-in, onboarding, workspace, and sign-out states

**Files:**

- Create: `apps/web/components/authenticated-home.tsx`
- Create: `apps/web/components/authenticated-home.test.tsx`
- Create: `apps/web/components/profile-onboarding.tsx`
- Create: `apps/web/components/profile-onboarding.test.tsx`
- Create: `apps/web/components/auth-error-boundary.tsx`
- Create: `apps/web/components/auth-error-boundary.test.tsx`
- Create: `apps/web/app/(authenticated)/sign-in/[[...sign-in]]/page.tsx`
- Create: `apps/web/app/(authenticated)/sign-up/[[...sign-up]]/page.tsx`
- Modify: `apps/web/app/(authenticated)/layout.tsx`
- Modify: `apps/web/app/(authenticated)/page.tsx`
- Modify: `apps/web/components/couple-workspace.tsx`
- Modify: `apps/web/components/couple-workspace.test.tsx`

**Interfaces:**

- Consumes: `createLoveChapterApi(getToken, onAuthenticationRequired)`,
  `AuthenticatedUser.onboardingComplete`, Clerk `useAuth`, Clerk `useUser`, and
  the existing Couple workspace operations.
- Produces: Clerk-bound smart root, reusable/testable authenticated state machine, Unicode profile form, sign-in/up pages, user sign-out control, and an auth-only retry boundary.

- [ ] **Step 1: Write failing authenticated-state tests**

Test the pure component through an injected session shape:

```ts
export type AuthenticatedSession = {
  isLoaded: boolean;
  isSignedIn: boolean;
  getToken: TokenProvider;
  suggestedDisplayName: string;
  signOut(): Promise<void>;
};
```

Cover:

- loading renders `Checking your session…` and does not call `getMe`;
- signed out renders an injected `signedOutFallback` node and no workspace;
- incomplete user renders the Display name form with the suggested Unicode
  value;
- submitting `"  มะลิ & Arun  "` calls `updateMyProfile` and then renders the
  workspace with `"มะลิ & Arun"`;
- complete user renders the workspace;
- initial `ApiError(401)` calls `signOut`, clears protected content, and does not
  leave a wedding name in the document;
- after the workspace and a wedding name are visible, a `401` from any protected
  workspace operation clears that content and calls `signOut` exactly once;
- transient initial error shows `Try again`, and retry calls `getMe` again.

Add profile-form tests for accessible label, submit disabled while saving,
Unicode submission, and server validation message.

- [ ] **Step 2: Write failing workspace and auth-boundary tests**

Change the workspace expectation to receive `identity` and `onSignOut` props,
remove `getMe` from `CoupleWorkspaceApi`, and assert:

```ts
expect(screen.getByText("Couple one")).toBeVisible();
expect(screen.queryByText(/development identity/i)).not.toBeInTheDocument();
await user.click(screen.getByRole("button", { name: /sign out/i }));
expect(onSignOut).toHaveBeenCalledOnce();
```

Add an error-boundary test with a child that throws once; it must render an
English fallback message and a `Try again` button that remounts the child. The
boundary is only installed inside the authenticated route group.

- [ ] **Step 3: Run the component tests and verify RED**

Run:

```bash
npm test -- --run apps/web/components/authenticated-home.test.tsx apps/web/components/profile-onboarding.test.tsx apps/web/components/auth-error-boundary.test.tsx apps/web/components/couple-workspace.test.tsx
```

Expected: FAIL because the new components and prop contracts do not exist.

- [ ] **Step 4: Refactor CoupleWorkspace to consume resolved identity**

Change its props to:

```ts
type Props = {
  identity: AuthenticatedUser;
  api: CoupleWorkspaceApi;
  onSignOut(): void;
};
```

Remove `getMe()` from `CoupleWorkspaceApi` and from the initial `Promise.all`.
Load only `listWeddings()` and the first guest page. Replace the development
badge with the resolved display name and an accessible `Sign out` button. This
avoids an extra identity/database round trip after the smart root already called
`GET /v1/me`.

- [ ] **Step 5: Implement the profile and authenticated state components**

`ProfileOnboarding` owns only the form and calls:

```ts
await api.updateMyProfile({ displayName: displayName.trim() });
```

`AuthenticatedHome` accepts a `signedOutFallback: ReactNode`, creates the
protected API once per token provider, resolves `GET /v1/me`, renders onboarding
or workspace, and uses a request-generation guard so stale retries cannot
overwrite newer state. Give the API factory one stable
`onAuthenticationRequired` callback that first clears the stored identity and
then awaits `signOut()`. Guard the callback so concurrent `401` responses only
start one sign-out. This callback covers both initial profile loading and every
later workspace request.

The Clerk adapter uses `useAuth()` and `useUser()`:

```tsx
const { isLoaded, isSignedIn, getToken, signOut } = useAuth();
const { user } = useUser();

return (
  <AuthenticatedHome
    signedOutFallback={<RedirectToSignIn />}
    session={{
      isLoaded,
      isSignedIn: Boolean(isSignedIn),
      getToken,
      suggestedDisplayName:
        user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? "",
      signOut: async () => {
        await signOut({ redirectUrl: "/sign-in" });
      },
    }}
  />
);
```

- [ ] **Step 6: Add Clerk sign-in/up routes and the authenticated error boundary**

Create catch-all client pages using Clerk's prebuilt components:

```tsx
<SignIn
  path="/sign-in"
  routing="path"
  signUpUrl="/sign-up"
  fallbackRedirectUrl="/"
/>
```

```tsx
<SignUp
  path="/sign-up"
  routing="path"
  signInUrl="/sign-in"
  fallbackRedirectUrl="/"
/>
```

Wrap `ClerkAppProvider` and authenticated children in `AuthErrorBoundary` in the
route-group layout. Do not modify the root layout or `/i/*`; a Clerk
initialization failure must not affect guest RSVP rendering.

- [ ] **Step 7: Run UI tests and both frontend builds**

Run:

```bash
npm test -- --run apps/web/components apps/web/lib
npm run typecheck --workspace @lovechapter/web
NEXT_PUBLIC_API_ORIGIN=https://api.example.workers.dev \
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA \
npm run build:next --workspace @lovechapter/web
NEXT_PUBLIC_API_ORIGIN=https://api.example.workers.dev \
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA \
npm run build --workspace @lovechapter/web
```

Expected: UI/client tests, type-check, native Next build, and vinext build pass;
build output includes root, sign-in, sign-up, and public invitation routes.

- [ ] **Step 8: Commit the authenticated experience**

```bash
git add apps/web
git commit -m "feat: add Clerk sign-in and onboarding"
```

---

### Task 7: Reconcile architecture documentation and run the final evidence pass

**Files:**

- Modify: `README.md`
- Modify: `docs/DECISIONS.md`
- Modify: `docs/OPEN_QUESTIONS.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/PROGRESS.md`
- Modify: `docs/QUERY_REVIEW.md`

**Interfaces:**

- Consumes: all implemented behavior and actual command output from Tasks 1–6.
- Produces: ADR-015, exact Clerk setup/deployment instructions, reconciled open questions, updated query review, and an evidence-backed progress record.

- [ ] **Step 1: Add the accepted architecture decision**

Add ADR-015 recording:

- Clerk is the authentication/session provider for authenticated users;
- Google and email OTP are the initial open-registration methods;
- guests remain account-free;
- local PostgreSQL membership/ownership remains authoritative;
- Clerk Organizations are not used;
- session tokens are verified networklessly with exact authorized parties;
- the exact SDK pins and vinext compatibility result.

- [ ] **Step 2: Reconcile open questions and operational documentation**

Remove resolved authentication-provider, email/password-vs-link, and Google
questions from `docs/OPEN_QUESTIONS.md`. Keep Apple, passkeys, mandatory MFA,
and support/admin authentication open.

Document these operator actions in `docs/DEPLOYMENT.md` and `README.md`:

1. create/claim Clerk development and production instances;
2. enable open registration, required verified email, email OTP, and Google;
3. disable password authentication;
4. configure the compact custom session claim JSON
   `{ "primaryEmail": "{{user.primary_email_address}}" }`;
5. configure real production Google OAuth credentials in Clerk;
6. set actual `*.workers.dev` redirect/origin values;
7. provide `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` at web build time;
8. provide API `CLERK_PUBLISHABLE_KEY` and `CLERK_JWT_KEY` through Worker
   configuration/secrets;
9. set production `AUTH_MODE=clerk` only after the values exist;
10. smoke-test Google, email OTP, onboarding, sign-out, protected API, and public
    RSVP without logging credentials.

- [ ] **Step 3: Update query and progress records**

In `docs/QUERY_REVIEW.md`, record:

- identity sync remains one statement and uses the unique provider/subject key;
- conflict updates verified email but preserves local display name;
- onboarding profile update is one primary-key-scoped statement;
- `PATCH /v1/me` intentionally performs two bounded statements in one repository
  session and no external call/transaction;
- no onboarding index was added.

In `docs/PROGRESS.md`, record only the actual final test count, artifact sizes,
compatibility result, and whether a live Clerk/Neon/deployment smoke test was
possible.

- [ ] **Step 4: Run the complete validation matrix**

Run:

```bash
npm run format
NEXT_PUBLIC_API_ORIGIN=https://api.example.workers.dev \
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA \
npm run check
npm run db:check --workspace @lovechapter/database
NEXT_PUBLIC_API_ORIGIN=https://api.example.workers.dev \
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA \
npm run build:next --workspace @lovechapter/web
NEXT_PUBLIC_API_ORIGIN=https://api.example.workers.dev \
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA \
npm exec --workspace @lovechapter/web -- vinext check
NEXT_PUBLIC_API_ORIGIN=https://api.example.workers.dev \
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA \
npm run deploy --workspace @lovechapter/web -- --dry-run
```

Expected: formatting, lint, five-workspace type-check, all tests, both Worker
builds, Drizzle check, native Next build, vinext compatibility check, and web
deployment dry-run pass.

- [ ] **Step 5: Scan artifacts and tracked files for unsafe values**

Run:

```bash
rg -l 'https://api\.example\.workers\.dev' apps/web/dist
if rg -q 'http://localhost:8787' apps/web/dist; then
  echo 'unexpected localhost API origin in web bundle' >&2
  exit 1
fi
if git ls-files | rg '(^|/)(\.env|\.dev\.vars)$'; then
  echo 'unexpected credential file tracked' >&2
  exit 1
fi
git diff --check
git status --short
```

Expected: configured public origins are embedded, no localhost API fallback is
present, no real environment file is tracked, no whitespace errors exist, and
only intentional documentation changes remain.

- [ ] **Step 6: Request independent code review and resolve findings**

Use `superpowers:requesting-code-review` against the full commit range from
`3d2d953` to `HEAD`. Require review of token handling, origin validation,
onboarding authorization, public-route independence, SQL/index choices, and
vinext compatibility. Fix every Critical or Important finding and rerun the
affected commands before completion.

- [ ] **Step 7: Commit final documentation and verification records**

```bash
git add README.md docs
git commit -m "docs: record Clerk authentication rollout"
git status --short --branch
```

Expected: working tree is clean. Do not claim live Clerk, Neon, Hyperdrive, or
Cloudflare deployment checks unless they were actually run with operator-provided
credentials.
