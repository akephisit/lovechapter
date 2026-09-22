# LoveChapter Custom Authentication and Dual-Runtime Backend Design

**Date:** 2026-09-22

**Status:** Approved conversational design; written specification awaiting owner review

**Scope:** Replace Clerk with first-party email/password authentication and make the Elysia API deployable to either Cloudflare Workers or Bun on a VPS

## 1. Objective

LoveChapter will own its authenticated-user identity system instead of using an
external authentication service. Couples, planners, and future collaborators
will register with email and password, verify their email, and use database-backed
sessions. Guests remain account-free and continue to use high-entropy invitation
links.

The frontend remains a Next.js/vinext Cloudflare Worker. The Elysia 2 backend
becomes a portable application with two supported production entrypoints:

- Cloudflare Workers;
- Bun on a VPS.

Each deployed environment selects exactly one backend runtime. Running the two
backend targets active-active in one environment is outside this design and
requires a new architecture decision.

This specification explicitly supersedes the Clerk direction in ADR-015 and
the Cloudflare-only backend-runtime portions of ADR-004 and ADR-005. It does not
replace Elysia 2, Next.js, Neon PostgreSQL, Drizzle, or the account-free guest
model.

## 2. Success criteria

The slice is complete when:

- open registration supports email and password;
- an account cannot establish an authenticated session before email verification;
- Resend delivers verification and password-reset messages through a replaceable
  email adapter;
- sign-in, session restoration, sign-out, forgotten-password, and password-reset
  flows work without an external auth provider;
- resetting a password revokes every existing session for the account;
- the browser holds the session only in a secure HTTP-only cookie;
- protected wedding access continues to be authorized from local PostgreSQL
  membership data;
- the same Elysia application passes the contract suite and production build for
  Cloudflare Workers and Bun;
- asynchronous and parallel work is bounded, idempotent where retried, and does
  not introduce N+1 database access;
- Clerk code, packages, and configuration are removed;
- project rules and deployment documentation describe both supported backend
  targets without weakening the frontend Worker decision.

## 3. Non-goals

This slice does not add:

- social login;
- magic-link or email-OTP sign-in;
- passkeys;
- multifactor authentication;
- phone or SMS authentication;
- email-address changes;
- device/session management UI;
- admin impersonation or support access;
- active-active Worker/VPS API deployment;
- Kubernetes, Redis, or a new microservice;
- an external authentication framework or managed authentication service.

Better Auth Infrastructure and similar managed extensions are not used.

## 4. Runtime architecture

### 4.1 Shared application core

One `createApp(dependencies)` factory constructs the Elysia application. Routes,
validation, authentication, authorization, domain services, and repositories are
shared. Runtime entrypoints are thin adapters and may not duplicate application
logic.

The shared core uses Web Standard `Request`, `Response`, `fetch`, and crypto APIs
where practical. Bun-only and Cloudflare-only APIs are confined to their runtime
packages or entrypoint modules.

### 4.2 Cloudflare Workers target

The Worker entrypoint:

- receives Wrangler bindings;
- obtains PostgreSQL connections through Hyperdrive and `pg`;
- exposes the Elysia Web Standard fetch handler;
- maps `ExecutionContext.waitUntil` and Scheduled events into the background-task
  interfaces;
- supplies trusted Cloudflare request metadata without accepting spoofable browser
  headers as identity or rate-limit inputs.

### 4.3 Bun/VPS target

The Bun entrypoint:

- starts the same Elysia application with Bun's HTTP server adapter;
- uses a process-wide bounded `pg.Pool` connected directly to Neon or PostgreSQL;
- maps Bun server request metadata into the same trusted request-context interface;
- runs the email-outbox worker as a separately controlled background loop;
- implements graceful startup and shutdown, including stopping job claims and
  draining or closing the database pool.

The repository pins one validated Bun release for repeatable production builds.
Upgrades repeat the Bun runtime, Elysia, crypto, database, and contract checks.

Bun-specific APIs are allowed only in this adapter. Domain and authentication
modules must remain usable without Bun.

### 4.4 One backend runtime per environment

Deployment configuration must state `worker` or `bun`; there is no implicit
fallback. A staging or production environment must not expose both backend
entrypoints against the same public application origin unless a later ADR defines
traffic routing, distributed rate limiting, deployment coordination, and job
deduplication.

### 4.5 Same-origin browser boundary

The browser calls only the public web origin. The frontend Worker proxies API
paths to the selected backend:

- through a Cloudflare Service Binding when the API target is a Worker;
- through an explicitly configured HTTPS backend origin when the API target is
  Bun/VPS.

The proxy preserves approved request/response headers and `Set-Cookie` while
dropping unapproved forwarding headers. A runtime-specific private ingress
credential authenticates the web proxy to the API; it is never included in
browser assets. The API still performs normal session authorization and does not
treat the proxy credential as a user identity.

This boundary keeps the session cookie first-party on `*.workers.dev` before a
custom domain exists and avoids relying on cross-site third-party cookies. Local
development provides the same path shape through an explicit development proxy.

Origins and upstream URLs remain configuration. The candidate domain
`lovechapter.tech` is not hardcoded.

## 5. Authentication boundaries

### 5.1 Separation from the product domain

Authentication tables are separate from the existing domain `users` table. A
verified session resolves to this principal:

```ts
{
  provider: "local",
  subject: authAccountId,
  displayName: verifiedEmail,
  email: verifiedEmail,
}
```

The existing identity synchronization boundary maps that principal to a domain
user. The local domain user remains authoritative for display name, onboarding,
wedding membership, roles, workspace ownership, and billing ownership.

Business repositories do not query password, token, session, or rate-limit
tables. Authentication never trusts a browser-supplied user, wedding, role, or
ownership value.

### 5.2 Auth modes

The fail-closed configuration remains:

- `AUTH_MODE=disabled`: protected routes reject authentication;
- `AUTH_MODE=development`: a complete environment-only development identity is
  accepted and must never be deployed as production auth;
- `AUTH_MODE=local`: first-party verified sessions are required.

The `clerk` mode and all Clerk configuration are removed.

## 6. Database design

All tables use explicit columns, deterministic constraints, and bounded queries.
Names below are logical names; the implementation may use the project's existing
timestamp helpers while preserving these semantics.

### 6.1 `auth_accounts`

- `id`: UUID primary key;
- `email`: preserved delivery/display address, maximum 320 characters;
- `email_key`: normalized case-insensitive lookup key, maximum 320 characters,
  unique;
- `password_hash`: versioned scrypt envelope;
- `email_verified_at`: nullable timestamp;
- `credential_version`: positive integer, initially `1`;
- `created_at`, `updated_at`.

The application trims surrounding whitespace, applies Unicode NFC, and treats
email identity as case-insensitive. It preserves the accepted address separately
for delivery. Acceptance is limited to addresses that pass server validation and
that Resend can deliver; the exact internationalized-email support matrix remains
documented as an open product/operations question rather than being assumed.

### 6.2 `auth_sessions`

- `id`: UUID primary key;
- `account_id`: foreign key to `auth_accounts`, cascade on account deletion;
- `token_hash`: SHA-256 hex digest, unique;
- `idle_expires_at`;
- `absolute_expires_at`;
- `last_seen_at`;
- `revoked_at`: nullable timestamp;
- `created_at`.

Indexes support:

- equality lookup by unique `token_hash`;
- revoking active sessions by `account_id`;
- bounded cleanup ordered by expiry.

The idle lifetime is seven days, the absolute lifetime is thirty days, and
activity refreshes the idle lifetime at most once per 24 hours without exceeding
the absolute expiry.

### 6.3 `auth_tokens`

- `id`: UUID primary key;
- `account_id`: foreign key to `auth_accounts`, cascade on account deletion;
- `purpose`: `verify_email` or `reset_password`;
- `token_hash`: SHA-256 hex digest, unique;
- `signing_key_version`: action-token HMAC key version;
- `expires_at`;
- `consumed_at`: nullable timestamp;
- `created_at`.

The verification lifetime is 30 minutes. The reset lifetime is 15 minutes. Token
consumption is a conditional database update inside a short transaction so two
concurrent consumers cannot both succeed.

An action token contains a version, the token-record identifier, and a 32-byte
HMAC over the version, identifier, account, purpose, and expiry. The database
stores the lookup hash and public metadata, but not the complete bearer token or
its MAC. The outbox processor reconstructs the same token from that metadata and
the versioned server-side HMAC key. A database disclosure without the HMAC key
cannot produce a usable action token. Old keys remain available only long enough
to drain jobs and expire tokens created with their version.

### 6.4 `auth_rate_limits`

- `scope`;
- `key_hash`: keyed digest of the trusted client fingerprint or normalized email
  key;
- `bucket_started_at`;
- `count`;
- `expires_at`;
- composite primary key over `scope`, `key_hash`, and `bucket_started_at`.

The portable implementation is PostgreSQL-backed. It uses atomic bounded upserts
and expiry indexes. It never persists a raw IP address. Runtime adapters supply a
trusted client address/fingerprint and never accept an arbitrary forwarded header
from the public request.

### 6.5 `auth_email_jobs`

- `id`: UUID primary key;
- `kind`: verification or reset;
- `account_id` and `auth_token_id` foreign keys;
- `idempotency_key`: unique;
- `available_at`;
- `leased_until`: nullable timestamp;
- `attempt_count`;
- `sent_at`: nullable timestamp;
- `last_error_code`: nullable sanitized code;
- `created_at`, `updated_at`.

Claims use bounded batches and `FOR UPDATE SKIP LOCKED`. Retries use backoff and a
finite attempt limit. Jobs are idempotent, and failure details never include a
token, complete email address, or provider response body.

### 6.6 Query review

The implementation must inspect generated migrations and SQL. Critical queries
must be reviewed for index support and round trips. Representative staging data
must be used for safe `EXPLAIN` checks when a live development/staging database is
available. No application list or cleanup query may be unbounded.

## 7. Password and token cryptography

### 7.1 Passwords

Passwords accept 12 to 128 Unicode code points. They are not trimmed, silently
normalized, truncated, or subjected to arbitrary uppercase/symbol composition
rules. The exact UTF-8 bytes are hashed.

`PasswordHasher` is a small interface. Its initial implementation uses the
asynchronous `node:crypto.scrypt` available in Cloudflare Workers and Bun/Node.
The versioned envelope records the algorithm, policy version, parameters, salt,
and derived key.

The initial production policy is:

- scrypt `N = 2^14`, `r = 8`, `p = 5`;
- a cryptographically random 16-byte salt;
- a 32-byte derived key;
- sufficient explicit `maxmem` for the selected parameters and runtime overhead.

This is an OWASP-published scrypt-equivalent parameter set. It must be benchmarked
in both production targets before deployment. If either target cannot execute it
within its production resource limits, implementation stops for a reviewed design
change; parameters are not silently weakened.

Verification uses a timing-safe comparison. A successful sign-in rehashes the
password when the stored policy version is older.

### 7.2 Session and action tokens

Session secrets contain 32 cryptographically random bytes encoded as base64url.
Session plaintext exists only in the HTTP-only cookie and request memory.
PostgreSQL stores only its SHA-256 hash.

Verification/reset tokens use the versioned HMAC format in Section 6.3. Their
32-byte MAC is a server-authenticated bearer secret; PostgreSQL stores only the
complete token's SHA-256 lookup hash and the non-secret reconstruction metadata.
The HMAC keys are deployment secrets, support rotation by version, and are never
committed.

Randomness uses `crypto.getRandomValues` or a runtime-equivalent cryptographically
secure API. `Math.random` is prohibited for security-sensitive values.

## 8. HTTP and cookie security

Production uses a host-only cookie named `__Host-lovechapter_session` with:

- `Secure`;
- `HttpOnly`;
- `SameSite=Lax`;
- `Path=/`;
- no `Domain` attribute.

Local HTTP development uses an explicitly different non-production cookie name
and rejects that configuration in production.

State-changing authenticated requests must:

- come through the configured web origin;
- present the session cookie;
- have an exact allowed `Origin` when browsers send one;
- use the expected JSON content type for JSON endpoints.

The API rejects malformed, expired, revoked, or unknown sessions with a stable
`401`. Authorization remains server-side and returns `403` only after identity is
established.

Automatic request logs and traces remain disabled until token-bearing invitation,
verification, and reset URLs are demonstrably redacted. Email links put their
secret in the URL fragment. The frontend reads the fragment, removes it from the
visible history entry, and sends it in a POST body; fragments are not transmitted
in the initial HTTP request.

## 9. User flows

### 9.1 Sign-up and verification

1. The user submits display name, email, and password.
2. The server validates inputs and rate limits both the trusted client fingerprint
   and email key.
3. One transaction creates or safely handles the pending account, invalidates an
   older outstanding verification token, creates the new token record, and inserts
   the email outbox job.
4. The endpoint returns a generic accepted response that does not reveal whether
   the email was already registered.
5. Resend sends the verification URL through the `EmailSender` adapter.
6. The frontend consumes the fragment and POSTs the token.
7. The server atomically marks the token consumed and the account verified.
8. Verification does not silently create a session; the user signs in with the
   password they chose.

### 9.2 Sign-in and session restoration

1. The user submits email and password.
2. Rate limiting runs before expensive password verification.
3. Existing and missing accounts take a deliberately similar response path; a
   fixed synthetic hash is used where needed to reduce enumeration by timing.
4. Only a verified account can create a session.
5. A new random session token is returned only as the secure cookie.
6. Session restoration performs one indexed session/account lookup and then uses
   the existing local-user synchronization boundary.

### 9.3 Sign-out

Sign-out conditionally revokes the current session and expires the cookie. It is
idempotent.

### 9.4 Forgotten password and reset

1. The request endpoint always returns the same accepted response.
2. If an eligible account exists, a short transaction invalidates an older reset
   token, creates a 15-minute token, and inserts an email job.
3. The reset page removes the token fragment and submits the token plus the new
   password in a POST body.
4. A successful conditional consume updates the password hash, increments the
   credential version, and revokes all sessions in one short transaction.
5. Reset does not auto-login the user.

### 9.5 Onboarding

The existing Unicode display-name onboarding and local profile ownership remain.
The sign-up display name seeds the initial local profile, while the existing
profile endpoint remains authoritative for later updates.

## 10. Resend and asynchronous processing

Resend is a transactional email transport, not an identity provider. It is hidden
behind an `EmailSender` interface implemented with standard `fetch`. Provider API
keys are secrets.

Creating an auth token and its email job is atomic. Sending happens after commit:

- Worker requests may ask `waitUntil` to process an immediately available bounded
  batch; a Scheduled handler performs durable retry scans;
- Bun runs the same processor in a controlled background runner separate from the
  HTTP request lifecycle.

The processor claims jobs with a lease, sends independent claimed jobs with a
small configured concurrency limit, and marks results individually. A process
crash or retry may attempt the same message again, so the provider call uses the
job idempotency key when supported and the email/token flow remains correct if a
duplicate message is delivered.

## 11. Asynchronous and parallel-work rules

The project rules will require:

- asynchronous APIs for network, database, crypto, and email operations;
- parallel execution only for independent operations;
- `Promise.all` only for a small statically bounded set;
- explicit concurrency limits for data-dependent or batched work;
- sequential execution for dependency chains and operations sharing one database
  transaction/client;
- set-based SQL instead of parallel loops issuing one query per row;
- idempotency for every retryable background job;
- cancellation, timeout, and error aggregation where applicable;
- moving CPU-heavy work away from the request loop when it cannot meet the
  runtime budget.

Parallelism may not be used to disguise N+1 access or to issue unbounded remote
work. Work that must survive a response is persisted before it is scheduled.

## 12. Error model

The API returns stable machine-readable error codes with English fallback copy
that is ready to be localized:

- `400` for malformed or invalid input;
- `401` for absent, invalid, expired, or revoked authentication;
- `403` for an authenticated principal without authorization;
- `409` only where a conflict can safely be disclosed;
- `429` for a rate-limited operation;
- `503` for a safely retryable dependency outage.

Sign-up, sign-in, verification resend, and forgotten-password responses do not
reveal account existence. Internal provider/database details never escape to the
client. Logs use event names and sanitized reason codes; they exclude passwords,
cookies, authorization values, raw tokens, token-bearing URLs, raw IP addresses,
and complete email addresses.

## 13. Test and validation strategy

### 13.1 Unit tests

- versioned scrypt hash and verification;
- Unicode password length and exact-value behavior;
- secure randomness and hash/envelope parsing;
- cookie attributes for production and development;
- email normalization and validation boundaries;
- session idle/absolute expiry;
- origin and content-type checks;
- stable generic error mapping;
- background retry/backoff and concurrency limits.

Expensive hashing tests may inject a test policy, but at least one compatibility
test per runtime executes the production policy.

### 13.2 Database and concurrency tests

- duplicate concurrent sign-up creates one account;
- concurrent token consumption has one winner;
- concurrent reset and sign-in cannot preserve an obsolete credential session;
- password reset revokes every active session;
- email-job claims do not duplicate ownership;
- rate-limit increments are atomic;
- cleanup, session, and job queries are bounded and index-supported;
- domain access remains scoped by authenticated user and wedding in SQL.

Generated migration and query SQL are reviewed. Safe representative `EXPLAIN`
checks are recorded when a development/staging PostgreSQL database exists.

### 13.3 API and UI tests

- sign-up, duplicate response, verification, sign-in, restoration, sign-out,
  forgotten-password, reset, and expired-token flows;
- unverified accounts cannot sign in;
- protected data clears when a session becomes invalid;
- CSRF/origin, cookie, rate-limit, and enumeration behavior;
- account-free guest RSVP remains unchanged;
- forms and copy handle Unicode and future localization expansion.

### 13.4 Runtime matrix

The same contract suite runs against:

- the Wrangler/Worker entrypoint;
- the Bun/VPS entrypoint.

Completion also requires format, lint, TypeScript checks, all tests, database
schema checks, Worker dry-run build, Bun production build/start smoke, native
Next build, vinext compatibility/build, and frontend Worker dry-run deployment.

Scrypt is benchmarked on both targets with the production policy. Results and any
runtime-specific workaround are recorded before deployment.

## 14. Migration and rollout

No live Clerk instance or production Clerk user population exists, so the rollout
does not migrate external users.

Implementation order is:

1. add runtime-neutral backend dependency seams and Bun entrypoint without
   changing auth behavior;
2. add auth schema, repositories, crypto, rate limiting, and email outbox through
   tests;
3. add local auth routes and the Resend adapter;
4. replace the Clerk web UI/session client with first-party forms and cookies;
5. add the same-origin proxy for both API targets;
6. pass both runtime matrices;
7. remove Clerk code and dependencies;
8. update all architecture, deployment, progress, open-question, database-review,
   and environment-example documentation;
9. provision Neon, Resend, and the selected backend target only after local and
   staging validation.

`AUTH_MODE` stays `disabled` by default. Production changes to `local` only after
database migrations, cryptographic secrets, exact public origins, ingress
credentials, and Resend configuration exist.

## 15. Documentation and locked-decision changes

Implementation updates these files consistently:

- `AGENTS.md`: frontend Worker lock, dual Worker/Bun production backend targets,
  one target per environment, portable shared logic, and bounded asynchronous
  concurrency rules;
- `PROJECT_CONTEXT.md`: replace Cloudflare-only backend language while keeping the
  frontend Worker direction and avoiding VPS-first-only architecture;
- `docs/DECISIONS.md`: supersede the affected portions of ADR-004/ADR-005 and all
  of ADR-015 with explicit replacement ADRs;
- `docs/DEPLOYMENT.md`: separate Worker and Bun/VPS backend procedures plus the
  shared frontend proxy/origin model;
- `docs/DATABASE_GUIDELINES.md` and `docs/QUERY_REVIEW.md`: document auth query and
  index review;
- `docs/OPEN_QUESTIONS.md`: remove the provider decision and retain MFA,
  admin/support auth, email-change, and internationalized-email delivery questions;
- `docs/PROGRESS.md`: replace the Clerk-complete status with verified custom-auth
  and dual-runtime results.

Historical Clerk design and plan documents remain in history as superseded
records; they are not rewritten to pretend the earlier decision never existed.

## 16. Security and operational gates

Deployment is blocked if any of these are missing:

- reviewed migrations and required unique/index constraints;
- successful production-policy scrypt execution on the selected runtime;
- HTTPS public origins and production cookie enforcement;
- high-entropy, non-committed action-token-HMAC, fingerprint-HMAC, proxy-ingress,
  and Resend secrets;
- generic enumeration-resistant responses;
- bounded rate limiting and outbox processing;
- passing Worker and Bun contract/build validation;
- a smoke test of the selected deployment target;
- secret-safe logging verification.

The implementation must not weaken these gates merely to make a deployment pass.

## 17. References

- OWASP Password Storage Cheat Sheet:
  <https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>
- Cloudflare Workers Node.js crypto support:
  <https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/>
- Cloudflare Workers Web Crypto API:
  <https://developers.cloudflare.com/workers/runtime-apis/web-crypto/>
- Bun Node.js compatibility:
  <https://bun.sh/docs/runtime/nodejs-compat>
