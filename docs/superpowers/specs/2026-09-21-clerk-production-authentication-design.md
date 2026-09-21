# LoveChapter — Clerk Production Authentication Design

**Status:** Proposed for written review

**Date:** 2026-09-21
**Scope:** Authenticated Couple/Planner entry, identity verification, and first-login onboarding

## 1. Purpose

Replace the first slice's fail-closed production authentication placeholder with
Clerk-managed authentication while preserving LoveChapter's existing domain,
authorization, tenancy, and database ownership boundaries.

The outcome is an open-registration web application where an authenticated user
can sign up with Google or an email verification code, choose a culturally
neutral display name, and enter the existing wedding workspace. Guests continue
to use secure invitation URLs without a normal account.

Success means:

- production requests are authenticated by verified Clerk session tokens;
- wedding authorization continues to come only from LoveChapter's database;
- sign-up is open and passwordless;
- the public invitation/RSVP flow remains account-free;
- the implementation builds on native Next.js and vinext/Cloudflare Workers;
- missing or invalid production authentication configuration fails closed.

## 2. Decisions

### 2.1 Authentication provider and methods

- Clerk is the production authentication provider.
- Registration is open to all users; no allowlist or invitation is required to
  create an authenticated account.
- Initial sign-in methods are Google and email verification code (email OTP).
- Passwords, phone/SMS login, Apple login, passkeys, and mandatory MFA are not
  part of this slice.
- Clerk Organizations are not used. LoveChapter remains the source of truth for
  weddings, membership roles, workspace ownership, and billing ownership.

Email OTP is preferred over an email-link flow for the first release because it
is Clerk's default email verification method and works without requiring the
verification link to be opened in the initiating browser/device.

### 2.2 Account and role model

Signing up creates an authenticated user, not a global Couple or Planner role.
Roles remain scoped to wedding membership. A user who creates a wedding becomes
that wedding's `owner`; invited authenticated collaborators can receive
wedding-specific roles in a later slice.

Creating an account does not create a wedding, assign a paid entitlement, or
make the user a billing owner.

### 2.3 International profile model

First-login onboarding asks for one `displayName` field rather than imposing a
first-name/last-name structure. The value supports Unicode, is trimmed, and must
contain 1–120 characters.

The browser may prefill the field from Clerk's profile, but the submitted value
is treated as ordinary user input and validated by the LoveChapter API. The
LoveChapter database is the source of truth for the display name.

## 3. Architecture

### 3.1 Responsibility boundary

Clerk owns:

- sign-up and sign-in UX;
- Google OAuth and email OTP verification;
- session lifecycle and session-token issuance;
- browser-side session state.

LoveChapter owns:

- the local user record;
- onboarding completion and display name;
- wedding membership and every application role;
- workspace and billing ownership;
- authorization and tenant scoping;
- guest invitations and RSVP access.

No Clerk role, organization, or client-supplied claim authorizes access to a
wedding.

### 3.2 Frontend integration

The preferred frontend SDK is `@clerk/nextjs`. Clerk integration is restricted
to client-side provider/components/hooks so the web Worker does not become an
authentication backend and does not need a Clerk secret key.

The route behavior is:

- `/sign-in/[[...sign-in]]` — Clerk prebuilt sign-in UI;
- `/sign-up/[[...sign-up]]` — Clerk prebuilt sign-up UI;
- `/` — smart authenticated entry point;
- `/i/{invitationToken}` — unchanged public guest route.

At `/`:

1. while Clerk initializes, render a stable authentication loading state;
2. when signed out, redirect to `/sign-in`;
3. when signed in, obtain the current Clerk session token;
4. call `GET /v1/me` with the token;
5. when onboarding is incomplete, render the display-name onboarding form;
6. when onboarding is complete, render the existing Couple workspace.

The existing web API client gains a request-scoped asynchronous token provider.
Protected calls attach `Authorization: Bearer <session token>`. Public invitation
and RSVP calls do not request or attach a Clerk token.

The workspace exposes a user menu with sign-out. Signing out clears local
workspace state through unmounting, ends the Clerk session, and returns to the
sign-in route.

### 3.3 vinext compatibility gate

Before feature implementation proceeds, pin the selected Clerk packages and
prove a minimal provider/sign-in build with:

- the native Next.js production build;
- the vinext production build;
- `vinext check`;
- the Cloudflare deployment dry-run.

If `@clerk/nextjs` cannot build or run through the verified vinext path, use
`@clerk/react` for browser-only provider/components/hooks. That fallback does
not alter the API token format, identity boundary, routes, database, or security
model. The reproduced incompatibility and exact pinned versions must be recorded
in `docs/DECISIONS.md`.

## 4. API identity flow

### 4.1 Identity provider

Add a Clerk implementation of the existing framework-independent
`IdentityProvider` interface. The configured identity factory supports exactly:

- `AUTH_MODE=disabled` — no protected request can authenticate;
- `AUTH_MODE=development` — existing environment-only local identity;
- `AUTH_MODE=clerk` — verified Clerk session identity.

There is no automatic fallback from `clerk` to `development`.

The Clerk provider uses `@clerk/backend` to authenticate the incoming Web
Standard `Request` and accepts only `session_token`. It supplies:

- `CLERK_PUBLISHABLE_KEY` to identify the Clerk instance;
- `CLERK_JWT_KEY` for networkless signature verification;
- `PUBLIC_WEB_ORIGIN` as the sole `authorizedParties` entry.

The verified Clerk `sub` claim becomes `Principal.subject` and the provider name
is `clerk`. A compact custom session claim named `primaryEmail` supplies the
verified primary email. No membership, ownership, billing, or application role
is read from Clerk claims.

If the bearer token is missing, invalid, expired, issued for another authorized
party, or lacks the required identity claims, the provider returns no principal
and the normal authentication boundary returns the stable `401` response. Logs
must not include the token, authorization header, primary email, or full claim
set.

### 4.2 Local user synchronization

The existing `(auth_provider, auth_subject)` unique identity remains the local
mapping key. On first authenticated access:

- insert a UUID local user with `auth_provider = 'clerk'`;
- store Clerk `sub` as `auth_subject`;
- store the verified primary email;
- use the primary email as a temporary display name;
- leave onboarding incomplete.

On identity conflict, synchronization updates the verified email and timestamp
but does not update the display name or onboarding status. This prevents a
provider-derived fallback from overwriting a user-selected LoveChapter profile.

User synchronization remains one parameterized PostgreSQL statement. Protected
application operations continue to use the current one-repository-session
boundary and do not call Clerk's Backend API per request.

## 5. Contract, domain, and API changes

### 5.1 Shared contracts

Extend `AuthenticatedUser` with:

```ts
onboardingComplete: boolean;
```

Add:

```ts
type UpdateProfileInput = {
  displayName: string;
};
```

### 5.2 Domain and repository ports

Add a repository operation that updates only the authenticated local user:

```ts
updateUserProfile(userId: string, input: UpdateProfileInput):
  Promise<AuthenticatedUser>;
```

The domain service trims and validates the display name, then supplies the user
ID resolved from the server-side identity. The client never supplies a user ID.

Protected wedding, guest, and invitation-management operations require an
onboarded user. `getMe` and `updateMyProfile` are the only authenticated
operations allowed before onboarding completes. An incomplete user attempting a
workspace operation receives a stable `403 onboarding_required` error.

### 5.3 HTTP API

Retain:

- `GET /v1/me`

Add:

- `PATCH /v1/me` with `{ displayName }`

`PATCH /v1/me` synchronizes the identity, validates and updates the profile, and
returns the updated `AuthenticatedUser`. Its two bounded database statements are
intentional for this one-time flow: one identity upsert and one profile update.
No external network call occurs inside a transaction.

CORS continues to allow only the exact configured `PUBLIC_WEB_ORIGIN` and adds
`Authorization` to `Access-Control-Allow-Headers`. Public API behavior and
invitation-token validation remain unchanged.

## 6. Database migration and queries

Add to `users`:

```sql
onboarding_completed_at timestamptz null
```

The field is nullable so existing development users and newly synchronized
Clerk users can be represented safely. Completing onboarding atomically sets the
validated display name, `onboarding_completed_at = now()`, and
`updated_at = now()` for the resolved local user ID.

No new index is added. The only new update uses the existing `users` primary
key, while authentication lookup continues to use
`users_auth_identity_unique (auth_provider, auth_subject)`.

The migration must be additive and compatible with the existing rows. Existing
development identities are considered onboarding-complete in development mode
by a documented application rule, so local workflows do not become blocked by
the new nullable field. Production Clerk users require the explicit onboarding
update.

Generated SQL and Drizzle metadata tests must verify:

- the nullable timestamp column;
- the unchanged auth-identity unique index;
- no redundant onboarding index;
- synchronization does not overwrite `display_name` on conflict;
- profile update is scoped by the resolved local primary key.

## 7. Configuration and deployment

### 7.1 Web build configuration

Add the build-time public value:

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`

It is validated alongside `NEXT_PUBLIC_API_ORIGIN`. Missing production values
must fail the build with a clear configuration error. The publishable key is not
a secret.

### 7.2 API Worker configuration

Add:

- `AUTH_MODE=clerk` in staging/production;
- `CLERK_PUBLISHABLE_KEY`;
- `CLERK_JWT_KEY`;
- the existing exact `PUBLIC_WEB_ORIGIN`.

`CLERK_JWT_KEY` is the PEM public verification key. It is supplied through
deployment configuration and never committed with a real environment value.
The API does not require `CLERK_SECRET_KEY` for this networkless verification
design.

The Clerk dashboard configuration must enable:

- open registration;
- required email address and verification at sign-up;
- email verification code for sign-up and sign-in;
- Google as a social connection;
- passwords disabled;
- one compact custom session claim:
  `primaryEmail = {{user.primary_email_address}}`.

Clerk development credentials may be used locally. Production Google OAuth
credentials and production Clerk instance activation remain an operator task;
they are not created or stored by repository code.

### 7.3 Domain and origin policy

Continue using generated `*.workers.dev` URLs until a custom domain is owned.
Clerk redirect URLs, the token's authorized party, web build variables, API
CORS, and `PUBLIC_WEB_ORIGIN` must use the actual generated origins. No
configuration assumes ownership of `lovechapter.tech`.

## 8. Error handling and privacy

- Missing, expired, malformed, or wrong-origin session token: stable `401`.
- Valid identity with incomplete onboarding on a workspace operation: stable
  `403 onboarding_required`.
- Invalid display name: stable `400 validation_error`.
- Clerk client initialization failure: retryable authentication error UI; the
  workspace is not rendered.
- Missing Clerk build/runtime configuration: explicit build/start failure; no
  development fallback.
- API `401` after an established browser session: clear protected UI state and
  return to sign-in through Clerk's session flow.
- API `5xx`: generic UI message with retry; no token or claim detail exposed.

Bearer tokens are held only by Clerk/browser memory and request headers. The
application does not place them in local storage, database fields, query
parameters, analytics, or logs. Worker invocation logs and traces remain
disabled until a reviewed credential-redaction strategy exists.

## 9. Testing and verification

### 9.1 Unit and contract tests

- Clerk identity accepts a valid session token and maps only trusted claims.
- Missing, malformed, expired, wrong-authorized-party, and missing-claim tokens
  fail closed.
- `AUTH_MODE=disabled`, `development`, and `clerk` remain explicit and do not
  fall through to one another.
- Identity synchronization inserts a first-time user and preserves a chosen
  display name on later requests.
- Profile validation accepts Unicode and rejects empty/overlong input.
- Profile update is scoped to the resolved local user.
- Incomplete onboarding blocks protected domain operations.
- Public invitation/RSVP operations remain unauthenticated.
- Error responses retain configured-origin CORS, including the `Authorization`
  header preflight behavior.

Clerk SDK behavior is wrapped behind a small injectable verifier boundary so
tests use local deterministic fakes rather than real Clerk credentials or
network calls.

### 9.2 UI tests

- signed-out root transitions to sign-in;
- authentication loading state does not render workspace data;
- first login renders onboarding;
- Unicode display name completes onboarding;
- completed user reaches the existing workspace;
- protected API calls receive a bearer token;
- public invitation calls do not request or receive a bearer token;
- session expiry returns the user to sign-in;
- Clerk initialization errors expose a retry action;
- guest RSVP regression tests continue to pass.

### 9.3 Required validation

Run and record:

- formatting;
- lint;
- all-workspace type-checking;
- full automated tests;
- Drizzle migration check and generated SQL review;
- native Next.js production build;
- vinext production build and compatibility check;
- API Worker dry-run;
- web Worker deployment dry-run;
- built-asset scan for unexpected localhost origins or secret values.

Live authentication smoke testing requires a user-provided/claimed Clerk
development instance. Staging deployment additionally requires real Clerk,
Google OAuth, Cloudflare, Neon, and Hyperdrive configuration. The implementation
must not claim those checks passed when credentials are unavailable.

## 10. Documentation updates after implementation

- Add an accepted ADR for Clerk production authentication and the local-role
  boundary.
- Update `docs/OPEN_QUESTIONS.md` to close provider, Google, and initial login
  method questions while leaving Apple, passkeys, support/admin auth, and MFA
  policy open.
- Update `docs/DEPLOYMENT.md` with Clerk dashboard, environment, redirect, and
  smoke-test requirements.
- Update `docs/QUERY_REVIEW.md` for identity synchronization and profile update.
- Update `docs/PROGRESS.md` with only checks that actually passed.

## 11. Explicit non-goals

- Clerk Organizations or Clerk-managed application authorization;
- global Couple/Planner account roles;
- authenticated collaborator invitations;
- production billing or entitlements;
- passwords, phone/SMS login, Apple login, passkeys, or mandatory MFA;
- support/admin impersonation or account-recovery policy;
- user account deletion/data-export workflow;
- a marketing site or moving the workspace to `/app`;
- a custom domain;
- production deployment without operator credentials.

These non-goals remain separate future product decisions and must not be
silently added while implementing this authentication slice.
