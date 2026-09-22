# Custom Authentication and Bun/VPS Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Clerk with first-party verified-email/password authentication, keep the Next.js frontend on Cloudflare Workers, and run the Elysia API plus durable email jobs on Bun on a VPS.

**Architecture:** The browser calls only same-origin `/api/*` routes on the frontend Worker. A server-only Next.js route handler proxies those requests to a private-credential-protected Bun/Elysia origin, preserving host-only cookies while keeping the VPS URL and ingress credential out of browser assets. A process-wide bounded PostgreSQL pool serves the API, a second Bun process claims PostgreSQL outbox jobs with leases, and framework-independent auth logic lives in a focused workspace package.

**Tech Stack:** TypeScript 6.0.3, Bun 1.4.2, Elysia 2.0.0-beta.16, Next.js 16.3.5, React 19.3.0, vinext 1.0.0-beta.10, Cloudflare Workers, PostgreSQL/Neon, Drizzle ORM 0.45.3, node-postgres 8.23.0, Resend HTTP API, Vitest 5.0.1, systemd, and Caddy.

**Spec:** `docs/superpowers/specs/2026-09-22-custom-auth-bun-vps-backend-design.md`

## Global Constraints

- Keep Next.js/vinext on Cloudflare Workers; Cloudflare Workers are not an API/backend production target.
- Keep Elysia 2.0.0-beta.16 unless an incompatibility is reproduced and the owner approves a change.
- Pin and validate Bun 1.4.2; Bun-only APIs belong only in API/job bootstrap modules.
- Support the initial production floor of 2 vCPU and 2 GiB RAM.
- Use a direct TLS PostgreSQL URL with `pg.Pool`; default API pool maximum is 6 and job pool maximum is 2.
- Keep `AUTH_MODE=disabled` as the default; allow only `disabled`, `development`, and `local`.
- Use asynchronous `node:crypto.scrypt` with `N=2^14`, `r=8`, `p=5`, a random 16-byte salt, a 32-byte key, 64 MiB `maxmem`, and a process-wide concurrency cap of 2.
- Accept passwords containing 12–128 Unicode code points without trimming, normalization, truncation, or composition rules.
- Use 32 random bytes for session secrets and 32-byte versioned HMACs for verification/reset action tokens.
- Use a 7-day idle and 30-day absolute session lifetime; refresh idle expiry at most once per 24 hours.
- Use 30-minute email-verification tokens and 15-minute password-reset tokens.
- Resetting a password increments `credential_version` and revokes every account session atomically; a concurrent stale sign-in may not create a surviving session.
- The production cookie is `__Host-lovechapter_session; Secure; HttpOnly; SameSite=Lax; Path=/` with no `Domain`; local HTTP uses `lovechapter_dev_session`.
- Persist no raw password, session secret, action-token MAC, raw IP address, complete token-bearing URL, or provider response body.
- Use Resend only as a replaceable email transport through standard `fetch`; do not add a managed auth framework.
- Use bounded SQL, explicit projections, parameterized values, short transactions, deterministic ordering, and no N+1 access.
- Keep guest invitation and RSVP access account-free and regression-tested.
- Keep all public origins and hostnames configurable. Treat `lovechapter.net` as intended but unconfirmed until ownership and DNS/TLS are verified.
- Keep user-facing fallback copy in English and all source identifiers, migrations, comments, and technical documentation in English.

## Review Focus

- A password containing combining marks or astral Unicode characters must be counted by code point and hashed byte-for-byte without hidden normalization; Task 3 adds exact-value tests.
- Two concurrent sign-ups for the same normalized email must produce one account and at most one current verification job without disclosing account existence; Tasks 4 and 5 add SQL and service concurrency tests.
- A password reset racing a sign-in made with the old hash must leave no valid session; Tasks 4 and 5 add a guarded session-insert and a live PostgreSQL race test.
- A browser-supplied proxy header, forwarded IP, cross-origin mutation, or malformed content type must not bypass the Worker/VPS boundary; Tasks 6 and 8 add ingress and proxy tests.
- A job-process crash, expired lease, Resend timeout, or duplicate delivery must preserve retry safety and never leak a token; Task 7 adds lease, retry, idempotency, and log-sanitization tests.

---

## File Structure

### New authentication package

- `packages/auth/package.json` — workspace manifest with no provider SDK.
- `packages/auth/tsconfig.json` — strict TypeScript project configuration.
- `packages/auth/src/types.ts` — account, session, token, rate-limit, and email-job records.
- `packages/auth/src/ports.ts` — `AuthRepository`, `PasswordHasher`, clock, and email-job interfaces.
- `packages/auth/src/email.ts` — email normalization/validation and `email_key` generation.
- `packages/auth/src/password.ts` — password validation, scrypt envelope, timing-safe verification, and bounded hashing semaphore.
- `packages/auth/src/tokens.ts` — session-token hashing plus versioned action-token encode/parse/reconstruct/verify.
- `packages/auth/src/rate-limits.ts` — fixed initial rate-limit policy and HMAC key derivation.
- `packages/auth/src/service.ts` — registration, verification, sign-in, session, sign-out, forgot/reset flows.
- `packages/auth/src/testing/in-memory-auth-repository.ts` — deterministic service/API test double.
- `packages/auth/src/index.ts` — package exports.
- Matching `*.test.ts` files — pure behavior tests.

### Database changes

- `packages/database/src/schema.ts` — five auth/outbox tables and access-pattern indexes.
- `packages/database/src/auth-queries.ts` — explicit auth SQL builders.
- `packages/database/src/auth-repository.ts` — transactional `AuthRepository` and email-job store.
- `packages/database/src/auth-query-contract.test.ts` — SQL projection, bound, locking, and predicate checks.
- `packages/database/src/auth-repository.test.ts` — result/error mapping tests.
- `packages/database/src/auth-postgres.integration.ts` — opt-in real PostgreSQL concurrency tests.
- `packages/database/src/client.ts` — process-wide bounded pool/runtime factory.
- `packages/database/drizzle/0002_custom_auth.sql` and metadata — generated migration.

### Bun API and jobs

- `apps/api/src/runtime-config.ts` — strict environment parsing and production guards.
- `apps/api/src/server.ts` — Bun 1.4.2 HTTP lifecycle and graceful shutdown.
- `apps/api/src/request-security.ts` — ingress credential, trusted fingerprint, Origin, and content-type checks.
- `apps/api/src/session-cookie.ts` — production/development cookie serialization and parsing.
- `apps/api/src/local-identity.ts` — database-backed local `IdentityProvider`.
- `apps/api/src/app.ts` — auth routes plus existing protected/public wedding routes.
- `apps/api/src/bun-runtime-smoke.ts` — Bun HTTP and production scrypt compatibility check.
- `apps/jobs/package.json`, `apps/jobs/tsconfig.json` — second Bun application workspace.
- `apps/jobs/src/runtime-config.ts` — strict job-process environment parsing.
- `apps/jobs/src/resend-email-sender.ts` — fetch-based Resend adapter with idempotency key.
- `apps/jobs/src/processor.ts` — leased bounded outbox processing and cleanup.
- `apps/jobs/src/index.ts` — abortable adaptive polling loop and graceful shutdown.

### Frontend changes

- `apps/web/app/api/[...path]/route.ts` — same-origin Worker-to-VPS proxy.
- `apps/web/lib/backend-proxy.ts` — allowlisted proxy construction and response forwarding.
- `apps/web/lib/api-client.ts` — same-origin cookie client and local-auth methods.
- `apps/web/components/auth-session-provider.tsx` — session restoration/sign-out state.
- `apps/web/components/auth-form-shell.tsx` — shared accessible auth-page presentation.
- `apps/web/components/sign-up-form.tsx`, `sign-in-form.tsx`, `forgot-password-form.tsx`, `verify-email-form.tsx`, `reset-password-form.tsx` — first-party flows.
- `apps/web/app/(auth)/*/page.tsx` — sign-up, sign-in, verification, forgotten-password, and reset routes.
- `apps/web/app/(workspace)/layout.tsx`, `apps/web/app/(workspace)/page.tsx` — protected workspace composition.

### Operations and documentation

- `deploy/systemd/lovechapter-api.service` and `deploy/systemd/lovechapter-jobs.service` — unprivileged services.
- `deploy/Caddyfile.example` — TLS reverse proxy to a loopback-only API port.
- `docs/QUERY_REVIEW.md` — auth/outbox SQL access-path review.
- `AGENTS.md`, `CODEX_START_PROMPT.md`, `PROJECT_CONTEXT.md`, `README.md`, and `docs/*.md` — approved stack, deployment, progress, and open questions.

---

### Task 1: Codify the Approved Runtime and Authentication Decisions

**Files:**

- Modify: `AGENTS.md`
- Modify: `CODEX_START_PROMPT.md`
- Modify: `PROJECT_CONTEXT.md`
- Modify: `README.md`
- Modify: `docs/DECISIONS.md`
- Modify: `docs/OPEN_QUESTIONS.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/DATABASE_GUIDELINES.md`
- Modify: `docs/PROGRESS.md`

**Interfaces:**

- Consumes: the approved design spec and explicit owner approval in this task history.
- Produces: project rules that lock frontend Worker + Bun/VPS backend + custom auth + Resend and permit all following code changes.

- [ ] **Step 1: Run a consistency audit and preserve the failing evidence**

```bash
rg -n "Cloudflare Workers production runtime|Cloudflare Worker -> Hyperdrive|Authentication: Clerk|AUTH_MODE=clerk|lovechapter\.tech|VPS deployment" AGENTS.md CODEX_START_PROMPT.md PROJECT_CONTEXT.md README.md docs
```

Expected: matches in current authoritative documentation prove it still contradicts the approved spec.

- [ ] **Step 2: Write the replacement decisions**

Add accepted ADRs that explicitly supersede the affected parts of ADR-004/ADR-005/ADR-007 and all of ADR-015:

```markdown
## ADR-016 — Bun/VPS is the sole backend production runtime

**Status:** Accepted; supersedes the backend-runtime portions of ADR-004, ADR-005, and ADR-007

The Next.js/vinext frontend remains on Cloudflare Workers. Elysia 2 runs as an
always-on Bun HTTP process on a VPS, with a separate Bun background-job process.
Both use bounded direct PostgreSQL pools. Hyperdrive and backend Workers are no
longer production targets.

## ADR-017 — First-party verified-email/password authentication

**Status:** Accepted; supersedes ADR-015

LoveChapter owns password credentials and database-backed sessions. Email must
be verified before sign-in. Resend is an isolated email transport, password
reset revokes every session, and guest RSVP remains account-free.

## ADR-018 — Intended domain remains unconfirmed

**Status:** Accepted; supersedes ADR-009's candidate name

The owner intends to register `lovechapter.net`, but the repository must treat
it as unowned until registration is verified. Origins and hostnames remain
configuration and deployment continues to use available generated URLs.
```

Update every authoritative stack/runtime/auth statement, add the bounded asynchronous-work rules, and mark `lovechapter.net` as the intended but unconfirmed domain. Remove `lovechapter.tech` as the active candidate without claiming ownership of the new name.

- [ ] **Step 3: Re-run the documentation audit**

```bash
rg -n "Cloudflare Workers production runtime|Cloudflare Worker -> Hyperdrive|Authentication: Clerk|AUTH_MODE=clerk|lovechapter\.tech" AGENTS.md CODEX_START_PROMPT.md PROJECT_CONTEXT.md README.md docs/OPEN_QUESTIONS.md docs/DEPLOYMENT.md docs/DATABASE_GUIDELINES.md docs/PROGRESS.md
rg -n "supersedes.*ADR-004|supersedes ADR-015|supersedes ADR-009" docs/DECISIONS.md
npx prettier --check AGENTS.md CODEX_START_PROMPT.md PROJECT_CONTEXT.md README.md docs
```

Expected: the first command returns no active-document matches; the second finds the three explicit superseding decisions; historical superpowers artifacts remain unchanged. Prettier passes.

- [ ] **Step 4: Commit the approved rules**

```bash
git add AGENTS.md CODEX_START_PROMPT.md PROJECT_CONTEXT.md README.md docs/DECISIONS.md docs/OPEN_QUESTIONS.md docs/DEPLOYMENT.md docs/DATABASE_GUIDELINES.md docs/PROGRESS.md
git commit -m "docs: lock Bun VPS and first-party auth"
```

### Task 2: Replace the API Worker Bootstrap with a Bounded Bun Runtime

**Files:**

- Modify: `package.json`
- Modify: `apps/api/package.json`
- Modify: `apps/api/tsconfig.json`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/elysia-typebox.ts`
- Modify: `packages/database/src/client.ts`
- Modify: `packages/database/src/client.test.ts`
- Create: `apps/api/src/runtime-config.ts`
- Create: `apps/api/src/runtime-config.test.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/server.test.ts`
- Create: `apps/api/src/bun-runtime-smoke.ts`
- Create: `apps/api/.env.example`
- Delete: `apps/api/src/index.ts`
- Delete: `apps/api/worker-configuration.d.ts`
- Delete: `apps/api/wrangler.jsonc`
- Delete: `apps/api/.dev.vars.example`

**Interfaces:**

- Consumes: `createApiApp(dependencies)` and `PostgresLoveChapterRepository`.
- Produces: `parseApiRuntimeConfig(env): ApiRuntimeConfig`, `createPostgresRuntime(config): PostgresRuntime`, and `startApiServer(options): Bun.Server`.

- [ ] **Step 1: Write failing configuration and pool tests**

```ts
expect(() =>
  parseApiRuntimeConfig({ NODE_ENV: "production", AUTH_MODE: "development" }),
).toThrow("AUTH_MODE=development is forbidden in production");
expect(parseApiRuntimeConfig(validEnvironment)).toMatchObject({
  bunVersion: "1.4.2",
  host: "127.0.0.1",
  port: 3001,
  databasePoolMax: 6,
});
expect(createPoolConfig(validEnvironment)).toMatchObject({
  max: 6,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
  query_timeout: 10_000,
});
```

- [ ] **Step 2: Run the focused tests and confirm they fail**

```bash
npx vitest run apps/api/src/runtime-config.test.ts packages/database/src/client.test.ts
```

Expected: FAIL because the runtime parser and pool factory do not exist.

- [ ] **Step 3: Install and pin the approved Bun runtime**

```bash
curl -fsSL https://bun.sh/install | bash -s "bun-v1.4.2"
export PATH="$HOME/.bun/bin:$PATH"
bun --version
```

Expected: the final command prints exactly `1.4.2`. Add `"bun": "1.4.2"` to the root `engines` object so unsupported runtimes fail visibly in deployment checks.

- [ ] **Step 4: Implement the runtime configuration and pool factory**

Use this public shape:

```ts
export type ApiRuntimeConfig = {
  bunVersion: "1.4.2";
  nodeEnvironment: "development" | "test" | "production";
  host: string;
  port: number;
  databaseUrl: string;
  databasePoolMax: number;
  publicWebOrigin: string;
  authMode: "disabled" | "development" | "local";
};

export type PostgresRuntime = {
  pool: Pool;
  loveChapterRepository: PostgresLoveChapterRepository;
  close(): Promise<void>;
};
```

Validate `Bun.version === "1.4.2"` in the production bootstrap, bind the Bun server to `127.0.0.1` by default, and configure one shared `pg.Pool`. Keep the existing Web Standard Elysia adapter so route tests still execute under Vitest; pass the compiled fetch handler to `Bun.serve` only in `server.ts`.

- [ ] **Step 5: Implement graceful HTTP lifecycle and live health**

```ts
export function startApiServer(options: {
  fetch(request: Request): Promise<Response> | Response;
  hostname: string;
  port: number;
}): Bun.Server {
  return Bun.serve({
    hostname: options.hostname,
    port: options.port,
    idleTimeout: 30,
    maxRequestBodySize: 1_048_576,
    fetch: options.fetch,
  });
}
```

On `SIGTERM`/`SIGINT`, reject new application traffic with `503`, call `server.stop(false)`, close the pool, and force termination only after a 30-second deadline. Keep `/health/live` database-free and move readiness/database checks to `/health/ready`.

- [ ] **Step 6: Replace scripts and verify the Bun build**

Use exact scripts:

```json
{
  "dev": "bun --watch src/server.ts",
  "build": "bun build src/server.ts --target=bun --sourcemap=linked --outfile=dist/server.js",
  "start": "bun dist/server.js",
  "smoke:bun": "bun src/bun-runtime-smoke.ts",
  "typecheck": "tsc --noEmit -p tsconfig.json"
}
```

Run:

```bash
npx vitest run apps/api/src/runtime-config.test.ts apps/api/src/server.test.ts packages/database/src/client.test.ts
bun --version
npm run build --workspace @lovechapter/api
npm run smoke:bun --workspace @lovechapter/api
```

Expected: Bun reports `1.4.2`; tests, build, live-health fetch, and shutdown smoke pass without a database connection.

- [ ] **Step 7: Commit the Bun runtime**

```bash
git add package.json package-lock.json apps/api packages/database/src/client.ts packages/database/src/client.test.ts
git commit -m "refactor: run Elysia API on bounded Bun runtime"
```

### Task 3: Add Authentication Contracts and Cryptographic Primitives

**Files:**

- Modify: `package.json`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/auth/package.json`
- Create: `packages/auth/tsconfig.json`
- Create: `packages/auth/src/types.ts`
- Create: `packages/auth/src/ports.ts`
- Create: `packages/auth/src/email.ts`
- Create: `packages/auth/src/email.test.ts`
- Create: `packages/auth/src/password.ts`
- Create: `packages/auth/src/password.test.ts`
- Create: `packages/auth/src/tokens.ts`
- Create: `packages/auth/src/tokens.test.ts`
- Create: `packages/auth/src/rate-limits.ts`
- Create: `packages/auth/src/rate-limits.test.ts`
- Create: `packages/auth/src/index.ts`

**Interfaces:**

- Consumes: Web Crypto plus asynchronous `node:crypto.scrypt` and `timingSafeEqual`.
- Produces: shared auth HTTP types, `PasswordHasher`, `ActionTokenCodec`, `hashSessionToken`, `normalizeEmail`, and `rateLimitKey`.

- [ ] **Step 1: Define HTTP contracts and port signatures**

```ts
export type SignUpInput = {
  displayName: string;
  email: string;
  password: string;
};
export type SignInInput = { email: string; password: string };
export type ResendVerificationInput = { email: string };
export type VerifyEmailInput = { token: string };
export type ForgotPasswordInput = { email: string };
export type ResetPasswordInput = { token: string; password: string };
export type AcceptedResponse = { accepted: true };
export type AuthSessionResponse = { user: AuthenticatedUser };

export type AuthTokenPurpose = "verify_email" | "reset_password";
export type ActionTokenClaims = {
  id: string;
  accountId: string;
  purpose: AuthTokenPurpose;
  signingKeyVersion: number;
  expiresAtEpochSeconds: number;
};
export type ActionTokenMetadata = ActionTokenClaims & {
  tokenHash: string;
  consumedAt: Date | null;
};
export type ParsedActionToken = {
  keyVersion: number;
  tokenId: string;
  expiryEpochSeconds: number;
  mac: Uint8Array;
};
export type ActionTokenIssue = {
  token: ActionTokenClaims & { tokenHash: string };
  job: {
    id: string;
    accountId: string;
    authTokenId: string;
    kind: AuthTokenPurpose;
    idempotencyKey: string;
    availableAt: Date;
  };
};
export type IssueActionToken = (accountId: string) => ActionTokenIssue;

export type AuthRateLimitScope =
  | "signUpFingerprint"
  | "signUpEmail"
  | "signInFingerprint"
  | "signInEmail"
  | "verificationFingerprint"
  | "verificationEmail"
  | "forgotFingerprint"
  | "forgotEmail"
  | "resetFingerprint";
export type RateLimitAttempt = {
  scope: AuthRateLimitScope;
  keyHash: string;
  bucketStartedAt: Date;
  expiresAt: Date;
  limit: number;
};
export type PendingRegistration = {
  candidateAccountId: string;
  email: string;
  emailKey: string;
  displayName: string;
  passwordHash: string;
  now: Date;
};
export type VerificationEmailRequest = ActionTokenIssue & {
  emailKey: string;
  now: Date;
};
export type AuthAccountForPassword = {
  id: string;
  email: string;
  emailKey: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  credentialVersion: number;
};
export type TokenConsumption = {
  tokenId: string;
  accountId: string;
  tokenHash: string;
  now: Date;
};
export type SessionCreation = {
  id: string;
  accountId: string;
  tokenHash: string;
  expectedCredentialVersion: number;
  expectedPasswordHash: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  now: Date;
};
export type ResolvedAuthSession = {
  accountId: string;
  email: string;
};
export type PasswordResetRequest = ActionTokenIssue & {
  emailKey: string;
  now: Date;
};
export type PasswordResetConsumption = TokenConsumption & {
  passwordHash: string;
};
export type EmailJobClaim = { now: Date; limit: number; leaseSeconds: number };
export type ClaimedEmailJob = {
  id: string;
  kind: AuthTokenPurpose;
  email: string;
  idempotencyKey: string;
  attemptCount: number;
  leasedUntil: Date;
  token: ActionTokenMetadata;
};
export type EmailJobCompletion = { id: string; leasedUntil: Date; now: Date };
export type EmailJobRetry = EmailJobCompletion & {
  availableAt: Date;
  lastErrorCode: string;
};
export type AuthCleanupRequest = { now: Date; limit: number };
export type AuthCleanupResult = {
  rateLimits: number;
  tokens: number;
  sessions: number;
  emailJobs: number;
};

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(
    password: string,
    envelope: string,
  ): Promise<{ valid: boolean; needsRehash: boolean }>;
  verifySynthetic(password: string): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export interface ActionTokenCodec {
  create(claims: ActionTokenClaims): string;
  parse(token: string): ParsedActionToken | null;
  verify(token: string, claims: ActionTokenClaims): boolean;
  hash(token: string): string;
}

export interface AuthRepository {
  consumeRateLimit(input: RateLimitAttempt): Promise<boolean>;
  registerPending(
    input: PendingRegistration,
    issueVerification: IssueActionToken,
  ): Promise<{ emailQueued: boolean }>;
  queueVerificationEmail(input: VerificationEmailRequest): Promise<boolean>;
  findAccountByEmailKey(
    emailKey: string,
  ): Promise<AuthAccountForPassword | null>;
  findActionToken(id: string): Promise<ActionTokenMetadata | null>;
  consumeEmailVerification(input: TokenConsumption): Promise<boolean>;
  createSessionIfCredentialsCurrent(input: SessionCreation): Promise<boolean>;
  resolveSession(
    tokenHash: string,
    now: Date,
  ): Promise<ResolvedAuthSession | null>;
  revokeSession(tokenHash: string, now: Date): Promise<void>;
  queuePasswordReset(input: PasswordResetRequest): Promise<boolean>;
  resetPasswordAndRevokeSessions(
    input: PasswordResetConsumption,
  ): Promise<boolean>;
}

export interface EmailJobStore {
  claimEmailJobs(input: EmailJobClaim): Promise<ClaimedEmailJob[]>;
  markEmailJobSent(input: EmailJobCompletion): Promise<void>;
  retryEmailJob(input: EmailJobRetry): Promise<void>;
  cleanupExpired(input: AuthCleanupRequest): Promise<AuthCleanupResult>;
}
```

Define the named input/output records in `types.ts`; each includes only the columns needed by that operation. Keep `AuthRepository` and `EmailJobStore` separate, and do not expose a generic query method from the auth package.

- [ ] **Step 2: Write failing Unicode, envelope, token, and fingerprint tests**

```ts
expect(validatePassword("💍".repeat(12))).toBe("💍".repeat(12));
expect(() => validatePassword("é".repeat(11))).toThrow(
  "12–128 Unicode code points",
);
expect(
  await hasher.verify(
    "e\u0301-password-123",
    await hasher.hash("é-password-123"),
  ),
).toMatchObject({ valid: false });
expect(hashSessionToken(sessionToken)).toMatch(/^[a-f0-9]{64}$/);
expect(codec.verify(codec.create(metadata), metadata)).toBe(true);
expect(codec.verify(tampered, metadata)).toBe(false);
expect(codecWithOldAndNewKeys.verify(oldVersionToken, oldMetadata)).toBe(true);
expect(rateLimitKey(secret, "203.0.113.7")).not.toContain("203.0.113.7");
```

- [ ] **Step 3: Run tests and confirm failure**

```bash
npx vitest run packages/auth/src
```

Expected: FAIL because the new package has no implementation.

- [ ] **Step 4: Implement exact password and token policies**

Use the envelope format:

```text
scrypt$v=1$N=16384$r=8$p=5$dk=32$<base64url-salt>$<base64url-derived-key>
```

Use `scrypt(password, salt, 32, { N: 16_384, r: 8, p: 5, maxmem: 67_108_864 })`, a FIFO semaphore capped at two calls, and timing-safe comparison. Commit one valid production-policy synthetic envelope for a known non-secret fixture password so missing-account sign-in performs the same KDF without doing startup hashing.

Use the action-token format:

```text
lc1.<key-version>.<token-record-uuid>.<expiry-epoch-seconds>.<43-char-base64url-mac>
```

The HMAC canonical input is `lc1\n<keyVersion>\n<tokenId>\n<accountId>\n<purpose>\n<expiryEpochSeconds>`. `ActionTokenCodec` receives `{ activeVersion, keys: ReadonlyMap<number, Uint8Array> }`; it signs only with the active key but verifies retained older versions. Parse before lookup, then verify the metadata, HMAC, complete-token SHA-256 hash, purpose, expiry, and consumed state.

- [ ] **Step 5: Implement normalization and fixed rate-limit policy**

Normalize email by trimming surrounding whitespace, applying NFC, lowercasing the lookup key, preserving the accepted address for delivery, and rejecting more than 320 Unicode code points or invalid server syntax. Define these atomic PostgreSQL bucket policies:

```ts
export const AUTH_RATE_LIMITS = {
  signUpFingerprint: { limit: 5, windowSeconds: 3600 },
  signUpEmail: { limit: 3, windowSeconds: 3600 },
  signInFingerprint: { limit: 20, windowSeconds: 900 },
  signInEmail: { limit: 10, windowSeconds: 900 },
  verificationFingerprint: { limit: 10, windowSeconds: 900 },
  verificationEmail: { limit: 3, windowSeconds: 3600 },
  forgotFingerprint: { limit: 5, windowSeconds: 3600 },
  forgotEmail: { limit: 5, windowSeconds: 3600 },
  resetFingerprint: { limit: 10, windowSeconds: 900 },
} as const;
```

- [ ] **Step 6: Run package checks and commit**

```bash
npm install
npx vitest run packages/auth/src
npm run typecheck --workspace @lovechapter/auth
git add package.json package-lock.json packages/contracts packages/auth
git commit -m "feat: add local auth cryptographic core"
```

### Task 4: Add Auth Schema, Migration, and Transactional PostgreSQL Repository

**Files:**

- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/schema.test.ts`
- Modify: `packages/database/src/client.ts`
- Modify: `packages/database/src/index.ts`
- Create: `packages/database/src/auth-queries.ts`
- Create: `packages/database/src/auth-query-contract.test.ts`
- Create: `packages/database/src/auth-repository.ts`
- Create: `packages/database/src/auth-repository.test.ts`
- Create: `packages/database/src/auth-postgres.integration.ts`
- Create: `packages/database/drizzle/0002_custom_auth.sql`
- Create: `packages/database/drizzle/meta/0002_snapshot.json`
- Modify: `packages/database/drizzle/meta/_journal.json`
- Modify: `packages/database/package.json`

**Interfaces:**

- Consumes: `AuthRepository` records and shared `QueryExecutor` transactions.
- Produces: `PostgresAuthRepository`, `PostgresEmailJobStore`, and `PostgresRuntime.authRepository/emailJobStore`.

- [ ] **Step 1: Write failing schema and SQL contract tests**

Assert the five new tables, constraints, and query behavior:

```ts
expect(authTableNames).toEqual([
  "auth_accounts",
  "auth_email_jobs",
  "auth_rate_limits",
  "auth_sessions",
  "auth_tokens",
]);
expect(signInSql).toMatch(/where "auth_accounts"\."email_key" = \$1/i);
expect(sessionSql).toMatch(/"token_hash" = \$1/i);
expect(claimSql).toMatch(/for update skip locked/i);
expect(claimSql).toMatch(/limit \$\d+/i);
expect(resetSql).toMatch(/update "auth_sessions"[\s\S]*"revoked_at"/i);
expect(guardedInsertSql).toMatch(/"credential_version" = \$\d+/i);
expect(allAuthSql).not.toMatch(/select\s+\*/i);
```

- [ ] **Step 2: Run focused tests and confirm failure**

```bash
npx vitest run packages/database/src/schema.test.ts packages/database/src/auth-query-contract.test.ts packages/database/src/auth-repository.test.ts
```

Expected: FAIL because schema, queries, and repositories are absent.

- [ ] **Step 3: Add the five tables and access-pattern indexes**

Implement the approved columns plus:

- `auth_accounts_email_key_unique`;
- `auth_sessions_token_hash_unique`;
- partial `auth_sessions_account_active_idx (account_id)` where `revoked_at is null`;
- partial active-session expiry and revoked-session cleanup indexes;
- `auth_tokens_token_hash_unique` plus account/purpose-active and expiry cleanup indexes;
- the composite `auth_rate_limits` primary key plus expiry cleanup index;
- `auth_email_jobs_idempotency_key_unique` plus a due-job index ordered by `(available_at, id)` for unsent, under-attempt-limit jobs.

Generate rather than hand-author the migration:

```bash
npx drizzle-kit generate --config packages/database/drizzle.config.ts --name custom_auth
npm run db:check --workspace @lovechapter/database
```

Expected: `0002_custom_auth.sql` creates only the five approved tables/enums/indexes and migration validation passes.

- [ ] **Step 4: Implement short transactional repository operations**

Key guarantees:

```ts
createSessionIfCredentialsCurrent(input): Promise<CreatedSession | null>;
consumeEmailVerification(input): Promise<boolean>;
resetPasswordAndRevokeSessions(input): Promise<boolean>;
claimEmailJobs(input: { now: Date; limit: number; leaseSeconds: number }): Promise<ClaimedEmailJob[]>;
```

`createSessionIfCredentialsCurrent` must use `INSERT ... SELECT` guarded by the observed account `credential_version`, verified state, and current password hash. `resetPasswordAndRevokeSessions` must lock/consume the reset token, update the hash/version, and revoke all active sessions in one transaction. Claims use a CTE with `FOR UPDATE SKIP LOCKED`, a deterministic `(available_at,id)` order, and a caller limit no greater than 10.

`registerPending` must atomically create or refresh only an unverified auth account, obtain the actual account ID after the unique-email conflict is resolved, synchronously call `issueVerification(actualAccountId)`, invalidate the prior active verification token, insert the replacement token/outbox job, and seed the existing `users` row with `auth_provider='local'`, `auth_subject=actualAccountId`, the submitted Unicode display name, preserved delivery email, and a non-null onboarding timestamp. This synchronous HMAC/ID callback performs no I/O and keeps account, token, and job atomic even when two different candidate IDs race for the same email. The transaction must never overwrite the password or profile of a verified account. `resolveSession` must perform one token-hash/account join and refresh idle expiry in the same bounded statement only when `last_seen_at` is at least 24 hours old.

- [ ] **Step 5: Add opt-in live PostgreSQL concurrency coverage**

The integration file is not part of the default glob. It must require both `TEST_DATABASE_URL` and `TEST_DATABASE_CONFIRM=lovechapter_test`, run only against a disposable database, and prove:

```ts
await Promise.all([registerSameEmail(), registerSameEmail()]); // one account
await Promise.all([consumeToken(), consumeToken()]); // exactly one true
await Promise.all([claimJobs(), claimJobs()]); // disjoint job ids
await Promise.all([resetPassword(), staleSessionInsert()]); // no valid stale session
```

Expose `npm run test:postgres --workspace @lovechapter/database` for this suite. Never silently point it at `DATABASE_URL`.

- [ ] **Step 6: Run SQL checks and commit**

```bash
npx vitest run packages/database/src/schema.test.ts packages/database/src/auth-query-contract.test.ts packages/database/src/auth-repository.test.ts
npm run db:check --workspace @lovechapter/database
npm run typecheck --workspace @lovechapter/database
git diff -- packages/database/drizzle/0002_custom_auth.sql
git add packages/database
git commit -m "feat: persist local auth and email outbox"
```

### Task 5: Implement Registration, Verification, Sessions, and Reset Services

**Files:**

- Create: `packages/auth/src/errors.ts`
- Create: `packages/auth/src/service.ts`
- Create: `packages/auth/src/service.test.ts`
- Create: `packages/auth/src/testing/in-memory-auth-repository.ts`
- Create: `packages/auth/src/testing/in-memory-auth-repository.test.ts`
- Modify: `packages/auth/src/index.ts`
- Modify: `packages/domain/src/errors.ts`

**Interfaces:**

- Consumes: `AuthRepository`, `PasswordHasher`, `ActionTokenCodec`, `Clock`, trusted request fingerprint, and existing local-user synchronization.
- Produces: `AuthService.signUp`, `resendVerificationEmail`, `verifyEmail`, `signIn`, `resolveSession`, `signOut`, `forgotPassword`, and `resetPassword`.

- [ ] **Step 1: Write failing service-flow tests**

Cover these exact observable behaviors:

```ts
await expect(auth.signUp(signUpInput, fingerprint)).resolves.toEqual({
  accepted: true,
});
await expect(auth.signUp(signUpInput, fingerprint)).resolves.toEqual({
  accepted: true,
});
expect(repository.accountsByEmailKey.size).toBe(1);
expect(repository.currentJobs("verification")).toHaveLength(1);

await expect(
  auth.signIn(unverifiedCredentials, fingerprint),
).rejects.toMatchObject({ code: "invalid_credentials" });
await expect(
  auth.signIn(missingCredentials, fingerprint),
).rejects.toMatchObject({ code: "invalid_credentials" });
expect(passwordHasher.syntheticVerifications).toBe(1);

await auth.resetPassword({ token, password: newPassword }, fingerprint);
await expect(auth.resolveSession(oldSessionToken)).resolves.toBeNull();
```

Also test one winner for concurrent token use, rehash on an old envelope, generic forgot-password responses, rate-limit `429`, token expiry, reset-without-auto-login, and old-password rejection.

- [ ] **Step 2: Run the service tests and confirm failure**

```bash
npx vitest run packages/auth/src/service.test.ts packages/auth/src/testing/in-memory-auth-repository.test.ts
```

Expected: FAIL because `AuthService` and the test repository do not exist.

- [ ] **Step 3: Implement the service API**

Use explicit result types:

```ts
export type CreatedSession = {
  token: string;
  idleExpiresAt: string;
  absoluteExpiresAt: string;
};

export class AuthService {
  signUp(input: SignUpInput, fingerprint: string): Promise<AcceptedResponse>;
  resendVerificationEmail(
    input: ResendVerificationInput,
    fingerprint: string,
  ): Promise<AcceptedResponse>;
  verifyEmail(
    input: VerifyEmailInput,
    fingerprint: string,
  ): Promise<{ verified: true }>;
  signIn(input: SignInInput, fingerprint: string): Promise<CreatedSession>;
  resolveSession(token: string): Promise<Principal | null>;
  signOut(token: string | null): Promise<void>;
  forgotPassword(
    input: ForgotPasswordInput,
    fingerprint: string,
  ): Promise<AcceptedResponse>;
  resetPassword(
    input: ResetPasswordInput,
    fingerprint: string,
  ): Promise<{ reset: true }>;
}
```

Rate limit before password hashing. Hash all syntactically valid sign-up passwords even when the verified account exists. Registration, verification-email resend, and forgotten-password calls always return `{ accepted: true }` for syntactically valid input, whether or not an eligible account exists. For sign-in, use the committed synthetic hash when the account is absent and always report missing/wrong/unverified as `invalid_credentials`. Generate token/job identifiers before entering repository transactions; never call email/network code while a transaction is open.

- [ ] **Step 4: Prove the reset/sign-in race at the service boundary**

Pause `createSessionIfCredentialsCurrent` after password verification, run reset, resume sign-in, and assert the guarded insert returns no session and the service reports `invalid_credentials`. This test pins the most important credential-version race without relying only on SQL text.

- [ ] **Step 5: Run all auth/domain tests and commit**

```bash
npx vitest run packages/auth/src packages/domain/src
npm run typecheck --workspace @lovechapter/auth
npm run typecheck --workspace @lovechapter/domain
git add packages/auth packages/domain/src/errors.ts
git commit -m "feat: implement first-party authentication flows"
```

### Task 6: Expose Secure Elysia Auth Routes and Local Session Identity

**Files:**

- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/api/src/api-identity.ts`
- Modify: `apps/api/src/api-identity.test.ts`
- Create: `apps/api/src/local-identity.ts`
- Create: `apps/api/src/local-identity.test.ts`
- Create: `apps/api/src/request-security.ts`
- Create: `apps/api/src/request-security.test.ts`
- Create: `apps/api/src/session-cookie.ts`
- Create: `apps/api/src/session-cookie.test.ts`
- Modify: `apps/api/src/server.ts`
- Delete: `apps/api/src/clerk-identity.ts`
- Delete: `apps/api/src/clerk-identity.test.ts`

**Interfaces:**

- Consumes: `AuthService`, `LoveChapterService`, trusted proxy metadata, and `PostgresRuntime`.
- Produces: `/v1/auth/*` routes, cookie-based local identity, and stable HTTP errors.

- [ ] **Step 1: Write failing request-security and cookie tests**

```ts
expect(
  await authorizeIngress(requestWithBrowserSpoofOnly, config),
).toMatchObject({ allowed: false });
expect(await authorizeIngress(requestFromProxy, config)).toMatchObject({
  allowed: true,
});
expect(() => requireMutationOrigin(crossOriginPost, webOrigin)).toThrow(
  "request_origin_rejected",
);
expect(productionCookie).toContain("__Host-lovechapter_session=");
expect(productionCookie).toContain("Secure");
expect(productionCookie).not.toContain("Domain=");
expect(developmentCookie).toContain("lovechapter_dev_session=");
```

- [ ] **Step 2: Write failing route contract tests**

Test `202` generic sign-up/resend/forgot responses, unverified `401`, verification, sign-in `Set-Cookie`, session restoration, idempotent sign-out, reset cookie clearing, `429`, exact Origin checks, JSON content type, invalid ingress, and unchanged public RSVP.

Run:

```bash
npx vitest run apps/api/src/request-security.test.ts apps/api/src/session-cookie.test.ts apps/api/src/local-identity.test.ts apps/api/src/app.test.ts
```

Expected: FAIL on missing local-auth behavior.

- [ ] **Step 3: Implement fail-closed identity modes**

```ts
export type ApiIdentityEnvironment = IdentityEnvironment & {
  AUTH_MODE?: "disabled" | "development" | "local";
};
```

`local` reads only the configured session cookie, hashes/resolves it through `AuthService`, and returns `{ provider: "local", subject: accountId, displayName: verifiedEmail, email: verifiedEmail }`. `disabled` and invalid modes resolve no identity. Production rejects `development` during configuration parsing. Configuration tests require at least 32 random bytes for the proxy credential and rate-limit HMAC key, and validate every action-token key version before the server starts.

- [ ] **Step 4: Add auth routes and stable errors**

```text
POST /v1/auth/sign-up                 -> 202 { accepted: true }
POST /v1/auth/verification-email      -> 202 { accepted: true }
POST /v1/auth/verify-email            -> 200 { verified: true }
POST /v1/auth/sign-in                 -> 200 + Set-Cookie
GET  /v1/auth/session                 -> 200 { user } or 401
POST /v1/auth/sign-out                -> 204 + expired cookie
POST /v1/auth/forgot-password         -> 202 { accepted: true }
POST /v1/auth/reset-password          -> 200 { reset: true } + expired cookie
```

Map malformed input to `400`, absent/invalid auth to `401`, authorization to `403`, rate limits to `429`, and safe dependency outages to `503`. Require the proxy credential on application routes and compare it with `timingSafeEqual`; require exact `Origin` plus JSON content type on state-changing routes, and derive the rate-limit fingerprint only from the proxy-injected address after ingress authentication.

`/health/live` is the only credential-free endpoint and returns only `{ "status": "ok" }`; it performs no database work and exposes no version/configuration data. `/health/ready` requires the ingress credential and performs one bounded `select 1`. Application logging emits named events plus sanitized reason codes and must never log raw request URLs, cookies, proxy credentials, client addresses, email addresses, or action/invitation tokens.

- [ ] **Step 5: Run API checks and commit**

```bash
npx vitest run apps/api/src
npm run typecheck --workspace @lovechapter/api
npm run build --workspace @lovechapter/api
npm run smoke:bun --workspace @lovechapter/api
git add apps/api
git commit -m "feat: expose secure local auth API"
```

### Task 7: Implement the Durable Resend Email Job Process

**Files:**

- Modify: `package.json`
- Create: `apps/jobs/package.json`
- Create: `apps/jobs/tsconfig.json`
- Create: `apps/jobs/.env.example`
- Create: `apps/jobs/src/runtime-config.ts`
- Create: `apps/jobs/src/runtime-config.test.ts`
- Create: `apps/jobs/src/resend-email-sender.ts`
- Create: `apps/jobs/src/resend-email-sender.test.ts`
- Create: `apps/jobs/src/processor.ts`
- Create: `apps/jobs/src/processor.test.ts`
- Create: `apps/jobs/src/index.ts`
- Modify: `packages/database/src/auth-queries.ts`
- Modify: `packages/database/src/auth-query-contract.test.ts`
- Modify: `packages/database/src/auth-repository.ts`

**Interfaces:**

- Consumes: `PostgresEmailJobStore`, `ActionTokenCodec`, Resend API key/from address, and `PUBLIC_WEB_ORIGIN`.
- Produces: `EmailSender.send(message, idempotencyKey)`, `processEmailBatch`, `runJobLoop(signal)`, and bounded cleanup.

```ts
export type EmailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

export interface EmailSender {
  send(
    message: EmailMessage,
    idempotencyKey: string,
  ): Promise<{ providerMessageId: string }>;
}
```

- [ ] **Step 1: Write failing Resend and processor tests**

```ts
expect(fetchMock).toHaveBeenCalledWith(
  "https://api.resend.com/emails",
  expect.objectContaining({
    headers: expect.objectContaining({ "Idempotency-Key": job.idempotencyKey }),
  }),
);
expect(maxObservedConcurrency).toBeLessThanOrEqual(3);
expect(store.retriedJobs[0]).toMatchObject({
  lastErrorCode: "provider_timeout",
});
expect(capturedLogs.join(" ")).not.toContain(job.email);
expect(capturedLogs.join(" ")).not.toContain(actionToken);
```

Also test expired leases becoming claimable, two claimers receiving disjoint IDs, consumed/expired tokens not being sent, `409 concurrent_idempotent_requests` retry, `409 invalid_idempotent_request` terminal failure, abort-driven shutdown, and empty-queue backoff.

- [ ] **Step 2: Run focused tests and confirm failure**

```bash
npx vitest run apps/jobs/src packages/database/src/auth-query-contract.test.ts
```

Expected: FAIL because the jobs workspace and processor are absent.

- [ ] **Step 3: Implement bounded job processing**

Use these constants:

```ts
const CLAIM_LIMIT = 10;
const SEND_CONCURRENCY = 3;
const LEASE_SECONDS = 120;
const MAX_ATTEMPTS = 8;
const MIN_IDLE_DELAY_MS = 250;
const MAX_IDLE_DELAY_MS = 5_000;
const CLEANUP_INTERVAL_MS = 15 * 60 * 1_000;
const CLEANUP_BATCH_SIZE = 500;
```

Retry delays are `min(15 seconds * 2^(attempt-1), 15 minutes)`. Reset idle delay after productive work and increase it only while the queue is empty. Reconstruct the action token from non-secret metadata, verify its stored hash before delivery, and send verification/reset links as `/verify-email#token=<encoded>` or `/reset-password#token=<encoded>`.

Use `auth-email/<job UUID>` as the stable Resend idempotency key. Every cleanup statement must take a limit of 500 and deterministic ID tie-breaker. Remove expired rate-limit buckets immediately, expired/consumed action tokens after 7 days, sent/exhausted email jobs after 7 days, and expired sessions after 30 days; repeat in later loop iterations rather than issuing an unbounded delete.

- [ ] **Step 4: Implement Resend with standard fetch**

Send `POST https://api.resend.com/emails` with `Authorization: Bearer`, JSON content, and `Idempotency-Key`. Use English text/HTML templates with no raw token in logs or subject. Categorize only sanitized codes such as `provider_timeout`, `provider_rate_limited`, `provider_rejected`, and `provider_unavailable`.

- [ ] **Step 5: Add build/start scripts and run checks**

```json
{
  "build": "bun build src/index.ts --target=bun --sourcemap=linked --outfile=dist/index.js",
  "start": "bun dist/index.js",
  "dev": "bun --watch src/index.ts",
  "typecheck": "tsc --noEmit -p tsconfig.json"
}
```

Update the root `build` script to run API, jobs, then web builds so `npm run check` covers both Bun production processes.

```bash
npm install
npx vitest run apps/jobs/src packages/database/src/auth-query-contract.test.ts packages/database/src/auth-repository.test.ts
npm run typecheck --workspace @lovechapter/jobs
npm run build --workspace @lovechapter/jobs
git add package.json package-lock.json apps/jobs packages/database/src
git commit -m "feat: deliver auth email through durable outbox"
```

### Task 8: Add the Same-Origin Frontend Worker Proxy

**Files:**

- Create: `apps/web/app/api/[...path]/route.ts`
- Create: `apps/web/lib/backend-proxy.ts`
- Create: `apps/web/lib/backend-proxy.test.ts`
- Modify: `apps/web/lib/api-client.ts`
- Modify: `apps/web/lib/api-client.test.ts`
- Modify: `apps/web/wrangler.jsonc`
- Modify: `apps/web/.env.local.example`
- Delete: `apps/web/lib/public-origin.ts`
- Delete: `apps/web/lib/public-origin.test.ts`

**Interfaces:**

- Consumes: server-only `API_UPSTREAM_ORIGIN`, `WEB_PROXY_SHARED_SECRET`, request `Origin`, cookies, and Cloudflare client-address metadata.
- Produces: `/api/<path>` forwarding to `<API_UPSTREAM_ORIGIN>/<path>` and a same-origin `apiRequest` with `credentials: "same-origin"`.

```ts
export type ProxyEnvironment = {
  apiUpstreamOrigin: string;
  proxySharedSecret: string;
  fetch: typeof fetch;
};

export async function proxyApiRequest(
  request: Request,
  path: string[],
  environment: ProxyEnvironment,
): Promise<Response>;
```

- [ ] **Step 1: Write failing proxy boundary tests**

```ts
expect(upstreamRequest.url).toBe(
  "https://api-origin.example.test/v1/auth/session",
);
expect(upstreamRequest.headers.get("x-lovechapter-proxy-secret")).toBe(secret);
expect(upstreamRequest.headers.get("x-lovechapter-client-address")).toBe(
  "203.0.113.7",
);
expect(upstreamRequest.headers.get("x-user-id")).toBeNull();
expect(response.headers.get("set-cookie")).toContain(
  "__Host-lovechapter_session",
);
expect(clientFetch).toHaveBeenCalledWith(
  "/api/v1/auth/session",
  expect.objectContaining({ credentials: "same-origin" }),
);
```

Test rejection of a path containing traversal, missing/invalid upstream URL, missing secret, inbound spoofed internal headers, unsupported methods, oversized bodies, and forwarding of `Retry-After` without forwarding hop-by-hop headers.

- [ ] **Step 2: Run focused tests and confirm failure**

```bash
npx vitest run apps/web/lib/backend-proxy.test.ts apps/web/lib/api-client.test.ts
```

Expected: FAIL because proxy and same-origin client behavior are absent.

- [ ] **Step 3: Implement the allowlisted route-handler proxy**

Export `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `OPTIONS` from the catch-all route and delegate to `proxyApiRequest`. The route reads `API_UPSTREAM_ORIGIN` and `WEB_PROXY_SHARED_SECRET` only from server-side `process.env` under the existing Workers `nodejs_compat` flag; neither name has a `NEXT_PUBLIC_` prefix. Forward only `accept`, `accept-language`, `content-type`, `cookie`, `origin`, and `user-agent`; inject the ingress secret and Cloudflare's `CF-Connecting-IP` value after deleting any inbound internal header, with a fixed local-development fingerprint when that platform header is absent. Return only `content-type`, `cache-control`, `etag`, `retry-after`, and every `set-cookie` value. Force `Cache-Control: no-store` on auth responses. Do not follow upstream redirects automatically.

- [ ] **Step 4: Convert the API client to cookie auth**

Remove token providers, bearer headers, and `NEXT_PUBLIC_API_ORIGIN`. Base all requests at `/api`, set `credentials: "same-origin"`, and add typed methods for every auth endpoint. Preserve the single `401` callback that clears protected workspace state.

- [ ] **Step 5: Validate Worker and browser-bundle boundaries**

```bash
npx vitest run apps/web/lib/backend-proxy.test.ts apps/web/lib/api-client.test.ts
npm run typecheck --workspace @lovechapter/web
npm run build --workspace @lovechapter/web
rg -n "WEB_PROXY_SHARED_SECRET|API_UPSTREAM_ORIGIN|api-origin\.example" apps/web/dist --glob '*.{js,css,html}'
```

Expected: tests/typecheck/build pass; the final `rg` returns no browser-asset secret or upstream-origin match.

- [ ] **Step 6: Commit the proxy**

```bash
git add apps/web
git commit -m "feat: proxy browser API calls through web origin"
```

### Task 9: Replace Clerk UI with First-Party Auth and Session State

**Files:**

- Modify: `apps/web/app/layout.tsx`
- Delete: `apps/web/app/(authenticated)/layout.tsx`
- Delete: `apps/web/app/(authenticated)/page.tsx`
- Delete: `apps/web/app/(authenticated)/sign-in/[[...sign-in]]/page.tsx`
- Delete: `apps/web/app/(authenticated)/sign-up/[[...sign-up]]/page.tsx`
- Create: `apps/web/app/(workspace)/layout.tsx`
- Create: `apps/web/app/(workspace)/page.tsx`
- Create: `apps/web/app/(auth)/sign-in/page.tsx`
- Create: `apps/web/app/(auth)/sign-up/page.tsx`
- Create: `apps/web/app/(auth)/verify-email/page.tsx`
- Create: `apps/web/app/(auth)/forgot-password/page.tsx`
- Create: `apps/web/app/(auth)/reset-password/page.tsx`
- Delete: `apps/web/components/clerk-app-provider.tsx`
- Create: `apps/web/components/auth-session-provider.tsx`
- Create: `apps/web/components/auth-session-provider.test.tsx`
- Create: `apps/web/components/auth-form-shell.tsx`
- Create: `apps/web/components/sign-up-form.tsx`
- Create: `apps/web/components/sign-up-form.test.tsx`
- Create: `apps/web/components/sign-in-form.tsx`
- Create: `apps/web/components/sign-in-form.test.tsx`
- Create: `apps/web/components/verify-email-form.tsx`
- Create: `apps/web/components/verify-email-form.test.tsx`
- Create: `apps/web/components/forgot-password-form.tsx`
- Create: `apps/web/components/forgot-password-form.test.tsx`
- Create: `apps/web/components/reset-password-form.tsx`
- Create: `apps/web/components/reset-password-form.test.tsx`
- Modify: `apps/web/components/authenticated-home.tsx`
- Modify: `apps/web/components/authenticated-home.test.tsx`
- Delete: `apps/web/lib/clerk-config.ts`
- Delete: `apps/web/lib/clerk-config.test.ts`

**Interfaces:**

- Consumes: cookie-auth methods from `createLoveChapterApi`.
- Produces: `AuthSessionProvider`, `useAuthSession()`, five accessible forms, and workspace redirects.

- [ ] **Step 1: Write failing session-provider and form tests**

```ts
expect(screen.getByLabelText("Email address")).toHaveAttribute(
  "autocomplete",
  "email",
);
expect(screen.getByLabelText("Password")).toHaveAttribute(
  "autocomplete",
  "current-password",
);
expect(await screen.findByText("Check your email")).toBeVisible();
expect(historyReplaceState).toHaveBeenCalledWith(null, "", "/verify-email");
expect(resetSubmit).toHaveBeenCalledWith({
  token,
  password: exactUnicodePassword,
});
expect(screen.getByText("Invalid email or password")).toBeVisible();
```

Also test no password trimming, 12–128 code-point client feedback, sign-in redirect, anonymous workspace fallback, expired session clearing, retryable session outage, generic forgot response, invalid/expired action token, and RTL/text-expansion-safe layout.

- [ ] **Step 2: Run focused UI tests and confirm failure**

```bash
npx vitest run apps/web/components/auth-session-provider.test.tsx apps/web/components/sign-up-form.test.tsx apps/web/components/sign-in-form.test.tsx apps/web/components/verify-email-form.test.tsx apps/web/components/forgot-password-form.test.tsx apps/web/components/reset-password-form.test.tsx
```

Expected: FAIL because first-party components are absent.

- [ ] **Step 3: Implement session state**

```ts
export type AuthSessionState =
  | { status: "loading"; user: null }
  | { status: "anonymous"; user: null }
  | { status: "authenticated"; user: AuthenticatedUser }
  | { status: "error"; user: null };

export type AuthSessionContextValue = AuthSessionState & {
  refresh(): Promise<void>;
  signOut(): Promise<void>;
};
```

Restore from `/v1/auth/session`, deduplicate an in-flight restoration, clear protected state on `401`, and keep transient errors separate from anonymous state. Workspace pages render the existing loading/error UI and navigate anonymous users to `/sign-in`.

- [ ] **Step 4: Implement the forms and fragment-token handling**

The sign-up form sends display name, preserved email input, and the exact password. Verification/reset components read `token` from `location.hash`, immediately call `history.replaceState(null, "", location.pathname + location.search)`, then POST the token. Password fields use `new-password`, sign-in uses `current-password`, messages use `role="alert"`/`role="status"`, and the copy stays English/localization-ready.

- [ ] **Step 5: Run all web tests/builds and commit**

```bash
npx vitest run apps/web
npm run typecheck --workspace @lovechapter/web
npm run build:next --workspace @lovechapter/web
npm run check:vinext --workspace @lovechapter/web
npm run build --workspace @lovechapter/web
git add apps/web
git commit -m "feat: add first-party account experience"
```

### Task 10: Remove Clerk and Prove the Complete Vertical Slice

**Files:**

- Modify: `apps/api/package.json`
- Modify: `apps/web/package.json`
- Modify: `package-lock.json`
- Modify: `apps/api/src/app.test.ts`
- Create: `apps/api/src/local-auth-flow.test.ts`
- Modify: `apps/web/components/public-rsvp.test.tsx`
- Modify: `apps/web/components/couple-workspace.test.tsx`
- Modify: `apps/web/public/sw.js`
- Create: `apps/web/public/sw.test.ts`

**Interfaces:**

- Consumes: complete API/auth/job/proxy/UI stack.
- Produces: provider-free dependency graph and end-to-end in-process proof of auth + wedding + guest + RSVP.

- [ ] **Step 1: Add the full in-process auth/wedding/RSVP test**

Exercise this exact sequence with the in-memory auth and domain repositories:

```text
sign up -> captured verification job -> reconstructed fragment token -> verify
-> sign in -> session cookie -> GET /v1/auth/session
-> create wedding -> add guest -> create invitation
-> account-free guest GET/PUT RSVP -> couple sees updated RSVP
-> forgot password -> reset -> old cookie 401 -> new password sign-in succeeds
```

Assert generic duplicate/forgot responses, no token in captured logs, and no auth requirement on invitation routes.

- [ ] **Step 2: Add service-worker and browser isolation regressions**

Assert `/api/`, `/i/`, verification, and reset traffic are never cached; protected data disappears after a session `401`; and action-token fragments never reach fetch/request URLs.

- [ ] **Step 3: Remove Clerk packages and confirm no active references**

```bash
npm uninstall @clerk/backend --workspace @lovechapter/api
npm uninstall @clerk/nextjs --workspace @lovechapter/web
rg -n -i "clerk|NEXT_PUBLIC_API_ORIGIN|HYPERDRIVE|lovechapter-api.*workers\.dev" apps packages package.json .env.example --glob '!**/dist/**'
```

Expected: no active source/config matches. Historical docs may still describe superseded work.

- [ ] **Step 4: Run the complete automated product suite**

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run db:check --workspace @lovechapter/database
npm run build --workspace @lovechapter/api
npm run build --workspace @lovechapter/jobs
npm run build:next --workspace @lovechapter/web
npm run check:vinext --workspace @lovechapter/web
npm run build --workspace @lovechapter/web
```

Expected: every command passes; guest RSVP and tenant-isolation tests remain green.

- [ ] **Step 5: Commit the provider removal and regression proof**

```bash
git add apps package.json package-lock.json
git commit -m "test: prove provider-free MVP authentication slice"
```

### Task 11: Add VPS Services, Scrypt Benchmark, Query Review, and Final Documentation

**Files:**

- Create: `deploy/systemd/lovechapter-api.service`
- Create: `deploy/systemd/lovechapter-jobs.service`
- Create: `deploy/Caddyfile.example`
- Create: `apps/api/src/scrypt-benchmark.ts`
- Create: `apps/api/src/scrypt-benchmark.test.ts`
- Modify: `apps/api/package.json`
- Modify: `.env.example`
- Modify: `apps/api/.env.example`
- Modify: `apps/jobs/.env.example`
- Modify: `apps/web/.env.local.example`
- Modify: `README.md`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/DATABASE_GUIDELINES.md`
- Modify: `docs/QUERY_REVIEW.md`
- Modify: `docs/OPEN_QUESTIONS.md`
- Modify: `docs/PROGRESS.md`
- Modify: `docs/DECISIONS.md`

**Interfaces:**

- Consumes: built API/job artifacts, production environment contract, generated SQL, and all validation output.
- Produces: repeatable systemd/Caddy deployment assets, benchmark evidence, query/index rationale, and truthful project status.

- [ ] **Step 1: Write the benchmark acceptance test**

```ts
expect(summarizeDurations([100, 200, 300, 400, 500]).p95).toBe(500);
expect(() => assertScryptBudget({ p95Ms: 751, maxConcurrent: 2 })).toThrow(
  "750 ms",
);
```

The production command performs one warm-up and at least 20 production-policy hashes with at most two concurrent calls, reports p50/p95/max and RSS, and exits non-zero when p95 exceeds 750 ms.

- [ ] **Step 2: Add hardened service definitions**

Use these material settings in both services:

```ini
User=lovechapter
Group=lovechapter
WorkingDirectory=/opt/lovechapter/current
Environment=NODE_ENV=production
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
```

The API executes `/usr/local/bin/bun apps/api/dist/server.js` with `/etc/lovechapter/api.env`; jobs execute `/usr/local/bin/bun apps/jobs/dist/index.js` with `/etc/lovechapter/jobs.env`. Only the API receives a loopback port. Set `TimeoutStopSec=35` so the 30-second application drain completes.

- [ ] **Step 3: Add the TLS reverse-proxy example**

```caddyfile
{$API_ORIGIN_HOST} {
  encode zstd gzip
  reverse_proxy 127.0.0.1:3001
}
```

Document a least-privilege `lovechapter` user, Bun 1.4.2 install pin, Node/npm dependency installation, artifact build, migration with a separate credential, atomic release directory switch, service restart/order, firewall, rollback, backup, and secret rotation. Do not place real hostnames or secrets in the repository.

Keep Caddy access logs and Bun raw-request logging disabled because guest invitation tokens remain in URL paths. Document that request logging may be enabled only after a tested redaction layer removes invitation paths, cookies, email addresses, proxy credentials, and action tokens.

Document and validate these environment groups:

```text
API: DATABASE_URL, DATABASE_POOL_MAX=6, AUTH_MODE, PUBLIC_WEB_ORIGIN,
     WEB_PROXY_SHARED_SECRET, RATE_LIMIT_HMAC_KEY,
     AUTH_TOKEN_ACTIVE_KEY_VERSION, AUTH_TOKEN_HMAC_KEYS, HOST, PORT
JOBS: DATABASE_URL, DATABASE_POOL_MAX=2, PUBLIC_WEB_ORIGIN,
      AUTH_TOKEN_ACTIVE_KEY_VERSION, AUTH_TOKEN_HMAC_KEYS,
      RESEND_API_KEY, RESEND_FROM_EMAIL
WEB: API_UPSTREAM_ORIGIN, WEB_PROXY_SHARED_SECRET
```

`AUTH_TOKEN_HMAC_KEYS` is a JSON object from positive integer versions to at least 32 random base64url bytes. Rotation adds a new version, deploys both processes with old+new keys, changes the active version, waits for queued jobs and token lifetimes to drain, then removes the old key. Production email remains blocked until the sender/domain is verified by Resend.

- [ ] **Step 4: Record SQL and migration review**

Extend `docs/QUERY_REVIEW.md` with expected cardinality, predicates, order/bounds, statement counts, indexes, and transaction boundaries for sign-up, sign-in, session lookup/refresh, token consumption, session revocation, rate limiting, outbox claim, retry, and cleanup. If `TEST_DATABASE_URL` is available, run and record safe representative `EXPLAIN` output; otherwise state precisely that live plans remain a staging gate.

- [ ] **Step 5: Update progress and unresolved operational gates**

Record the actual passing commands and retain only unresolved items such as domain ownership/DNS/TLS, Neon region/staging credentials, Resend domain verification, internationalized-email support, MFA, email-address changes, admin/support auth, and live query plans. Do not claim `lovechapter.net`, a VPS, Neon, or Resend is provisioned unless verified.

- [ ] **Step 6: Run final local validation**

```bash
npm run format
npm run format:check
npm run lint
npm run typecheck
npm test
npm run db:check --workspace @lovechapter/database
npm run build --workspace @lovechapter/api
npm run smoke:bun --workspace @lovechapter/api
npm run benchmark:auth --workspace @lovechapter/api
npm run build --workspace @lovechapter/jobs
npm run build:next --workspace @lovechapter/web
npm run check:vinext --workspace @lovechapter/web
npm run build --workspace @lovechapter/web
npm run deploy --workspace @lovechapter/web -- --dry-run
git diff --check
```

If a disposable PostgreSQL database is configured:

```bash
TEST_DATABASE_CONFIRM=lovechapter_test npm run test:postgres --workspace @lovechapter/database
```

Expected: all available local checks pass. Missing domain/provider/database/VPS credentials are documented as staging/deployment gates rather than fabricated successes.

- [ ] **Step 7: Commit the operational handoff**

```bash
git add deploy .env.example apps/api apps/jobs apps/web/.env.local.example README.md docs
git commit -m "docs: add Bun VPS auth operations guide"
```

### Task 12: Final Review, Push, and Deployment Gate Handoff

**Files:**

- Review: all changes since `2562e1a`
- Modify only when review finds a defect: affected source/test/documentation files

**Interfaces:**

- Consumes: all task commits and validation evidence.
- Produces: reviewed `main`, public GitHub push, and an explicit list of external provisioning steps still requiring owner credentials.

- [ ] **Step 1: Review the complete change set**

```bash
git diff --stat 2562e1a..HEAD
git diff --check 2562e1a..HEAD
git status --short --branch
```

Use `superpowers:requesting-code-review` for a fresh whole-branch review. Fix findings through focused failing tests and rerun their owning task checks.

- [ ] **Step 2: Re-run the release gate after review fixes**

```bash
npm run check
npm run db:check --workspace @lovechapter/database
npm run smoke:bun --workspace @lovechapter/api
npm run benchmark:auth --workspace @lovechapter/api
npm run build --workspace @lovechapter/jobs
npm run build:next --workspace @lovechapter/web
npm run check:vinext --workspace @lovechapter/web
npm run deploy --workspace @lovechapter/web -- --dry-run
git status --short --branch
```

Expected: all commands pass and the worktree is clean.

- [ ] **Step 3: Push the reviewed main branch**

```bash
git push origin main
```

Expected: GitHub `main` advances to the reviewed local HEAD. Do not deploy the frontend or VPS until the owner provides/authorizes the external credentials and the security/hostname gates in the spec are satisfied.

- [ ] **Step 4: Report the handoff truthfully**

Report implemented commits, exact passing checks, migration/index decisions, benchmark result, public repository URL, and outstanding external gates. The next smallest milestone is provisioning a disposable Neon branch and Resend development domain, then running live PostgreSQL, email, proxy, restart, and job-recovery staging smoke tests before production.
