# LoveChapter First MVP Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify the smallest secure end-to-end LoveChapter flow from Couple identity through Wedding and Guest creation to token-based RSVP and Couple-visible status.

**Architecture:** Use two Cloudflare Workers in an npm-workspace monorepo: a Next.js 16/vinext web application and an Elysia 2 API. Keep domain behavior behind ports, implement persistence with Drizzle + node-postgres through Hyperdrive, and leave production authentication behind a fail-closed provider boundary.

**Tech Stack:** Node 24, npm 11, TypeScript 6.x, Next.js 16.3.5, React 19.3.0, vinext 1.0.0-beta.10, Elysia 2.0.0-beta.16, Drizzle ORM 0.45.3, pg 8.23.0, Tailwind CSS 4.3.3, shadcn/ui-style local components, Vitest 5, Wrangler 4.135.0.

**Spec:** `docs/superpowers/specs/2026-09-21-first-mvp-vertical-slice-design.md`

## Global Constraints

- Keep the two deployment names `lovechapter-web` and `lovechapter-api` and use only configurable `*.workers.dev` origins.
- Do not add a custom-domain assumption or the candidate domain to production configuration.
- Use Elysia `2.0.0-beta.16` with `CloudflareAdapter` from `elysia/adapter/cloudflare-worker` and call `.compile()` in the Worker entry point.
- Use Next.js 16 App Router through Cloudflare's current vinext path; run `vinext check` and both the Next and vinext builds.
- Use `pg` through Hyperdrive in production, with one client per operation and `finally` cleanup.
- Never trust client-supplied user, role, membership, ownership, guest scope, or billing scope.
- Store only SHA-256 invitation-token hashes; raw tokens exist only in the creation response and URL.
- Bound every list, use deterministic keyset pagination, explicit projections, and wedding scoping in SQL.
- Preserve creator, workspace owner, member role, and optional billing owner as distinct fields.
- Keep production authentication disabled until a provider is selected; the development adapter reads identity only from server environment.
- This workspace has no Git metadata, so commit steps are replaced with verification checkpoints rather than initializing a repository implicitly.

## Review Focus

- A client attempts to access another wedding by changing a wedding/guest ID: return not found and never read or mutate the row; exercised in Tasks 3, 4, and 5.
- An invitation is invalid, revoked, or expired: disclose no wedding/guest data and reject RSVP; exercised in Tasks 3 and 5.
- A guest submits party size zero while accepting, a positive party size while declining, or a size above allowance: reject with a validation error; exercised in Tasks 2, 3, and 5.
- More than one row shares a timestamp at a page boundary: the `(createdAt,id)` cursor neither duplicates nor skips rows; exercised in Tasks 2 and 4.
- Production auth is unconfigured or a browser spoofs identity headers: protected endpoints fail closed; exercised in Tasks 3 and 5.

---

### Task 1: Monorepo and Cloudflare foundations

**Files:**

- Create: `package.json`, `package-lock.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json`, `.gitignore`, `.env.example`
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/wrangler.jsonc`, `apps/api/.dev.vars.example`
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/next.config.ts`, `apps/web/vite.config.ts`, `apps/web/wrangler.jsonc`, `apps/web/.env.local.example`
- Create: `packages/contracts/package.json`, `packages/domain/package.json`, `packages/database/package.json`

**Interfaces:**

- Produces: npm workspaces `@lovechapter/contracts`, `@lovechapter/domain`, `@lovechapter/database`, `@lovechapter/api`, and `@lovechapter/web`; root scripts `format`, `format:check`, `lint`, `typecheck`, `test`, `build`, and `check`.

- [x] **Step 1: Create pinned workspace manifests and shared TypeScript configuration**

```json
{
  "name": "lovechapter",
  "private": true,
  "workspaces": ["apps/*", "packages/*"],
  "engines": { "node": ">=24" },
  "scripts": {
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "lint": "eslint .",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "test": "vitest run",
    "build": "npm run build --workspace @lovechapter/api && npm run build --workspace @lovechapter/web",
    "check": "npm run format:check && npm run lint && npm run typecheck && npm test && npm run build"
  }
}
```

- [x] **Step 2: Add Worker configuration with environment-only origins and Hyperdrive binding placeholders**

```jsonc
{
  "$schema": "../../node_modules/wrangler/config-schema.json",
  "name": "lovechapter-api",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-21",
  "compatibility_flags": ["nodejs_compat"],
  "vars": {
    "AUTH_MODE": "disabled",
    "PUBLIC_WEB_ORIGIN": "http://localhost:3000",
  },
  "hyperdrive": [
    { "binding": "HYPERDRIVE", "id": "00000000000000000000000000000000" },
  ],
}
```

- [x] **Step 3: Install exact compatible dependencies and retain the generated lockfile**

Run: `npm install`

Expected: npm resolves all workspaces without peer dependency errors and writes `package-lock.json`.

- [x] **Step 4: Verify the empty workspace foundation**

Run: `npm run typecheck --workspaces --if-present`

Expected: each configured workspace exits successfully before production modules are added.

### Task 2: Shared contracts and domain rules

**Files:**

- Create: `packages/contracts/src/index.ts`
- Create: `packages/domain/src/errors.ts`, `packages/domain/src/identity.ts`, `packages/domain/src/invitations.ts`, `packages/domain/src/rsvp.ts`, `packages/domain/src/cursor.ts`, `packages/domain/src/ports.ts`, `packages/domain/src/index.ts`
- Test: `packages/domain/src/invitations.test.ts`, `packages/domain/src/rsvp.test.ts`, `packages/domain/src/cursor.test.ts`

**Interfaces:**

- Produces: `generateInvitationToken(): string`, `hashInvitationToken(token: string): Promise<string>`, `validateRsvp(input, allowedPartySize): RsvpSubmission`, `encodeCursor(cursor): string`, `decodeCursor(value): ListCursor`, `IdentityProvider.resolve(): Promise<Principal | null>`, and repository/service port types.

- [x] **Step 1: Write failing invitation tests**

```ts
it("creates a 256-bit URL-safe token and a deterministic hash", async () => {
  const first = generateInvitationToken();
  const second = generateInvitationToken();
  expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(second).not.toBe(first);
  expect(await hashInvitationToken(first)).toMatch(/^[a-f0-9]{64}$/);
  expect(await hashInvitationToken(first)).toBe(
    await hashInvitationToken(first),
  );
});
```

- [x] **Step 2: Run the invitation test and verify RED**

Run: `npx vitest run packages/domain/src/invitations.test.ts`

Expected: FAIL because `generateInvitationToken` and `hashInvitationToken` do not exist.

- [x] **Step 3: Implement invitation token generation and hashing with Web Crypto**

```ts
export function generateInvitationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytesToBase64Url(bytes);
}

export async function hashInvitationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return bytesToHex(new Uint8Array(digest));
}
```

- [x] **Step 4: Write failing RSVP and cursor tests, including every Review Focus boundary**

```ts
it.each([
  [{ attendance: "attending", partySize: 0 }, 2],
  [{ attendance: "attending", partySize: 3 }, 2],
  [{ attendance: "declined", partySize: 1 }, 2],
])("rejects an inconsistent RSVP %#", (input, allowed) => {
  expect(() => validateRsvp(input, allowed)).toThrow(DomainValidationError);
});

it("round-trips tied timestamps with the id tie-breaker", () => {
  const cursor = {
    createdAt: "2026-09-21T10:00:00.000Z",
    id: "018f0000-0000-7000-8000-000000000002",
  };
  expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
});
```

- [x] **Step 5: Run the tests and verify RED, then implement minimal validators, cursor parsing, errors, contracts, and ports**

Run: `npx vitest run packages/domain/src`

Expected before implementation: FAIL for missing exports. Expected after implementation: PASS with all domain cases green.

- [x] **Step 6: Run the full suite checkpoint**

Run: `npm test`

Expected: all Task 2 tests pass with no warnings.

### Task 3: Application services and identity boundary

**Files:**

- Create: `packages/domain/src/service.ts`, `packages/domain/src/testing/in-memory-repository.ts`
- Test: `packages/domain/src/service.test.ts`, `packages/domain/src/identity.test.ts`

**Interfaces:**

- Consumes: Task 2 ports and rules.
- Produces: `LoveChapterService` methods `getMe`, `listWeddings`, `createWedding`, `listGuests`, `addGuest`, `createInvitation`, `getPublicInvitation`, and `submitRsvp`; `createConfiguredIdentityProvider(env)`.

- [x] **Step 1: Write failing service tests for the complete flow and cross-wedding denial**

```ts
const wedding = await service.createWedding({
  name: "Mali & Arun",
  timeZone: "Asia/Bangkok",
  locale: "en",
});
const guest = await service.addGuest(wedding.id, {
  name: "Nok",
  allowedPartySize: 2,
});
const invitation = await service.createInvitation(wedding.id, guest.id);
expect(repository.persistedInvitation(invitation.id)?.tokenHash).not.toContain(
  invitation.token,
);
await publicService.submitRsvp(invitation.token, {
  attendance: "attending",
  partySize: 2,
});
expect(
  (await service.listGuests(wedding.id, { limit: 20 })).items[0]?.rsvp
    ?.attendance,
).toBe("attending");
await expect(
  otherCoupleService.listGuests(wedding.id, { limit: 20 }),
).rejects.toThrow(NotFoundError);
```

- [x] **Step 2: Run service tests and verify RED**

Run: `npx vitest run packages/domain/src/service.test.ts`

Expected: FAIL because `LoveChapterService` is missing.

- [x] **Step 3: Implement the service as orchestration over one repository port**

```ts
export class LoveChapterService {
  constructor(
    private readonly identity: IdentityProvider,
    private readonly repository: LoveChapterRepository,
    private readonly publicWebOrigin: string,
  ) {}

  async createInvitation(weddingId: string, guestId: string) {
    const user = await this.requireUser();
    const token = generateInvitationToken();
    return this.repository.createInvitation({
      id: crypto.randomUUID(),
      weddingId,
      guestId,
      createdByUserId: user.id,
      tokenHash: await hashInvitationToken(token),
      token,
      publicUrl: `${this.publicWebOrigin}/i/${token}`,
    });
  }
}
```

- [x] **Step 4: Write failing identity tests for disabled mode and spoofed headers**

```ts
it("fails closed when auth is disabled", async () => {
  const provider = createConfiguredIdentityProvider({ AUTH_MODE: "disabled" });
  await expect(
    provider.resolve(
      new Request("https://api.test", {
        headers: { "x-user-id": crypto.randomUUID() },
      }),
    ),
  ).resolves.toBeNull();
});
```

- [x] **Step 5: Implement environment-only development identity and rerun all domain tests**

Run: `npx vitest run packages/domain/src`

Expected: all complete-flow, tenant-denial, token-state, RSVP-update, and fail-closed identity tests pass.

### Task 4: PostgreSQL schema, migration, and bounded repositories

**Files:**

- Create: `packages/database/drizzle.config.ts`, `packages/database/src/schema.ts`, `packages/database/src/client.ts`, `packages/database/src/repository.ts`, `packages/database/src/index.ts`
- Create: `packages/database/drizzle/0000_first_mvp.sql` plus Drizzle metadata
- Test: `packages/database/src/schema.test.ts`, `packages/database/src/query-contract.test.ts`

**Interfaces:**

- Consumes: `LoveChapterRepository` from Task 2.
- Produces: `PostgresLoveChapterRepository` and `withPostgresRepository(connectionString, operation)`.

- [x] **Step 1: Write failing schema contract tests for required constraints and indexes**

```ts
it("keeps tenant relationships and active invitations database-enforced", () => {
  expect(migrationSql).toContain('FOREIGN KEY ("wedding_id","guest_id")');
  expect(migrationSql).toContain(
    'CREATE UNIQUE INDEX "invitations_one_active_per_guest"',
  );
  expect(migrationSql).toContain('WHERE "revoked_at" IS NULL');
  expect(migrationSql).toContain('UNIQUE("wedding_id","guest_id")');
});
```

- [x] **Step 2: Run schema tests and verify RED**

Run: `npx vitest run packages/database/src/schema.test.ts`

Expected: FAIL because the migration and schema are absent.

- [x] **Step 3: Define only the six MVP tables and generate the migration**

Run: `npm run db:generate --workspace @lovechapter/database`

Expected: Drizzle reports six tables and emits one PostgreSQL migration.

- [x] **Step 4: Inspect and, if required, correct the generated SQL using a custom migration**

Required SQL properties:

```sql
CREATE UNIQUE INDEX "users_auth_identity_unique" ON "users" ("auth_provider", "auth_subject");
CREATE INDEX "wedding_members_user_created_idx" ON "wedding_members" ("user_id", "created_at" DESC, "wedding_id" DESC);
CREATE INDEX "guests_wedding_created_idx" ON "guests" ("wedding_id", "created_at" DESC, "id" DESC);
CREATE UNIQUE INDEX "invitations_token_hash_unique" ON "invitations" ("token_hash");
CREATE UNIQUE INDEX "invitations_one_active_per_guest" ON "invitations" ("wedding_id", "guest_id") WHERE "revoked_at" IS NULL;
CREATE UNIQUE INDEX "rsvps_wedding_guest_unique" ON "rsvps" ("wedding_id", "guest_id");
```

- [x] **Step 5: Write failing query-contract tests for scope, projection, bound, cursor, and statement count**

```ts
it("lists guests in one bounded tenant-scoped statement", () => {
  const query = buildListGuestsQuery({ weddingId, userId, limit: 21, cursor });
  expect(query.text).toContain("wedding_members");
  expect(query.text).toContain("guests.wedding_id");
  expect(query.text).toContain("LIMIT");
  expect(query.text).not.toMatch(/SELECT\s+\*/i);
  expect(query.statementCount).toBe(1);
});
```

- [x] **Step 6: Implement the repository with parameterized Drizzle/sql templates**

The guest-list statement must join membership and left-join RSVP once, apply `(created_at,id) < ($cursorAt,$cursorId)`, order by both columns descending, and request `limit + 1`. Invitation lookup and RSVP upsert each use one statement and derive scope from the token hash.

- [x] **Step 7: Verify generated migration and repository tests**

Run: `npm run db:check --workspace @lovechapter/database && npx vitest run packages/database/src`

Expected: migration snapshot is stable; schema and query-contract tests pass.

### Task 5: Elysia 2 API Worker

**Files:**

- Create: `apps/api/src/env.ts`, `apps/api/src/http-errors.ts`, `apps/api/src/app.ts`, `apps/api/src/index.ts`
- Test: `apps/api/src/app.test.ts`

**Interfaces:**

- Consumes: `LoveChapterService`, `PostgresLoveChapterRepository`, and shared contracts.
- Produces: compiled Cloudflare Worker fetch handler and the endpoints listed in the design spec.

- [x] **Step 1: Write failing request-level tests with an injected service**

```ts
it("does not accept spoofed identity and maps missing auth without leaking details", async () => {
  const response = await app.handle(
    new Request("https://api.test/v1/weddings", {
      headers: { "x-user-id": crypto.randomUUID() },
    }),
  );
  expect(response.status).toBe(401);
});

it("rejects an oversized public RSVP", async () => {
  const response = await app.handle(
    jsonRequest("/v1/public/invitations/token/rsvp", "PUT", {
      attendance: "attending",
      partySize: 99,
    }),
  );
  expect(response.status).toBe(400);
});
```

- [x] **Step 2: Run API tests and verify RED**

Run: `npx vitest run apps/api/src/app.test.ts`

Expected: FAIL because `createApiApp` is absent.

- [x] **Step 3: Implement validated routes, configured CORS, and stable error mapping**

```ts
export function createApiApp(dependencies: ApiDependencies) {
  return new Elysia()
    .onRequest(({ request, set }) =>
      applyConfiguredCors(request, set, dependencies.publicWebOrigin),
    )
    .get("/health", () => ({ status: "ok" as const }))
    .post(
      "/v1/weddings",
      ({ body, request }) => dependencies.service(request).createWedding(body),
      { body: weddingInput },
    )
    .put(
      "/v1/public/invitations/:invitationToken/rsvp",
      ({ params, body }) =>
        dependencies.publicService.submitRsvp(params.invitationToken, body),
      { params: tokenParams, body: rsvpInput },
    )
    .onError(({ error, set }) => mapHttpError(error, set));
}
```

- [x] **Step 4: Export only the compiled Cloudflare-adapted app from `index.ts`**

```ts
export default new Elysia({ adapter: CloudflareAdapter })
  .use(createApiApp(createProductionDependencies(env)))
  .compile();
```

- [x] **Step 5: Run API tests, type-check, and Wrangler dry-run**

Run: `npx vitest run apps/api/src && npm run typecheck --workspace @lovechapter/api && npm run build --workspace @lovechapter/api`

Expected: request tests pass and `wrangler deploy --dry-run --outdir dist` bundles an Elysia 2 Worker successfully.

### Task 6: Responsive Next.js/vinext web flow

**Files:**

- Create: `apps/web/app/layout.tsx`, `apps/web/app/page.tsx`, `apps/web/app/globals.css`, `apps/web/app/manifest.ts`, `apps/web/app/i/[invitationToken]/page.tsx`
- Create: `apps/web/components/couple-workspace.tsx`, `apps/web/components/public-rsvp.tsx`, `apps/web/components/ui/{button,input,label,card,badge,select,textarea}.tsx`
- Create: `apps/web/lib/api-client.ts`, `apps/web/lib/public-origin.ts`, `apps/web/lib/utils.ts`, `apps/web/public/sw.js`, `apps/web/components/pwa-register.tsx`
- Test: `apps/web/components/couple-workspace.test.tsx`, `apps/web/components/public-rsvp.test.tsx`, `apps/web/lib/public-origin.test.ts`, `apps/web/vitest.setup.ts`

**Interfaces:**

- Consumes: API JSON contracts and `NEXT_PUBLIC_API_ORIGIN`.
- Produces: Couple workspace at `/`, guest flow at `/i/[invitationToken]`, web manifest, and conservative shell-only service worker.

- [x] **Step 1: Write failing UI tests for labeled forms, result states, and RSVP updates**

```tsx
it("shows the invitation and submits an accessible attending response", async () => {
  render(<PublicRsvp token="safe-token" api={fakeApi} />);
  expect(
    await screen.findByRole("heading", { name: /you're invited/i }),
  ).toBeVisible();
  await user.click(screen.getByLabelText(/joyfully accept/i));
  await user.selectOptions(screen.getByLabelText(/party size/i), "2");
  await user.click(screen.getByRole("button", { name: /save rsvp/i }));
  expect(await screen.findByRole("status")).toHaveTextContent(/saved/i);
});
```

- [x] **Step 2: Run web tests and verify RED**

Run: `npx vitest run apps/web/components`

Expected: FAIL because the client components do not exist.

- [x] **Step 3: Implement the API client and local shadcn/ui primitives**

```ts
const apiOrigin = parsePublicApiOrigin(process.env.NEXT_PUBLIC_API_ORIGIN);
export async function apiRequest<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(new URL(path, apiOrigin), {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!response.ok) throw await ApiError.fromResponse(response);
  return response.json() as Promise<T>;
}
```

- [x] **Step 4: Implement the Couple workspace and public RSVP route**

Use focused forms and one bounded guest table/card list. Invitation links are displayed only immediately after creation. The public view distinguishes loading, invalid/expired, editable RSVP, saved, and retryable error states without exposing token internals.

- [x] **Step 5: Add metadata, manifest, and shell-only service worker registration**

The service worker may cache versioned static assets and navigation shell responses but must never cache API mutations, invitation API responses, or raw token URLs.

- [x] **Step 6: Run web tests and accessibility-oriented assertions**

Run: `npx vitest run apps/web/components`

Expected: Couple creation/guest/invitation/status flow and public RSVP form tests pass.

- [x] **Step 7: Run vinext compatibility and both web builds**

Run: `npm exec --workspace @lovechapter/web vinext check && npm run build:next --workspace @lovechapter/web && npm run build --workspace @lovechapter/web`

Expected: compatibility report contains no blocking issue; Next and vinext production builds succeed.

### Task 7: Documentation, SQL review, and completion verification

**Files:**

- Modify: `README.md`, `docs/PROGRESS.md`, `docs/DECISIONS.md`, `docs/OPEN_QUESTIONS.md`, `docs/DEPLOYMENT.md`
- Create: `docs/QUERY_REVIEW.md`

**Interfaces:**

- Consumes: all implementation and actual verification output.
- Produces: reproducible local setup, migration/deployment instructions, recorded version decisions, query/index rationale, and honest blocker status.

- [x] **Step 1: Document exact local and Cloudflare setup**

Include commands for dependency installation, `.dev.vars`/`.env.local`, Neon direct URL for migrations, Hyperdrive creation with the unpooled Neon URL, binding replacement, local API/web start, migration, dry-run, and deploy. Do not invent deployed URLs.

- [x] **Step 2: Record query and index review**

For each repository method list expected cardinality, tenant predicate, joins, ordering, limit, index support, and database round trips. Explicitly state that `EXPLAIN` was not run when no representative PostgreSQL connection is available.

- [x] **Step 3: Update decisions and open questions**

Record exact version selections and compatibility findings in `docs/DECISIONS.md`; retain production auth provider, domain, Neon region, and RLS as open; record that the development identity adapter is not production authentication.

- [x] **Step 4: Run formatter and static checks**

Run: `npm run format && npm run format:check && npm run lint && npm run typecheck`

Expected: every command exits 0 with no unreported warnings.

- [x] **Step 5: Run the full automated test suite**

Run: `npm test`

Expected: all domain, application, repository-contract, API, and web tests pass.

- [x] **Step 6: Re-run migration and production builds**

Run: `npm run db:check --workspace @lovechapter/database && npm run build`

Expected: no migration drift; both Workers build.

- [x] **Step 7: Update progress with actual evidence only**

List the exact successful commands, test count, build results, any compatibility warnings, absent production credentials, absent `EXPLAIN`, and the next smallest milestone (production auth provider integration plus deployed Neon/Hyperdrive staging verification).
