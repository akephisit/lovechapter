# LoveChapter — Architecture Decisions

## ADR-001 — Global web-first SaaS

**Status:** Accepted

LoveChapter is a global, web-first Wedding Planning SaaS.

Native mobile applications are not required for the first product version. PWA capability is preferred.

## ADR-002 — Guests do not require normal accounts

**Status:** Accepted

Guests use secure invitation URLs/tokens/QR codes and can RSVP without account/password creation.

## ADR-003 — Ownership, membership, creation, and billing are independent

**Status:** Accepted

Keep separate:

- creator;
- workspace owner;
- membership role;
- billing owner.

## ADR-004 — Cloudflare-first

**Status:** Accepted

Frontend and API target Cloudflare Workers.

Do not introduce VPS/Kubernetes/Redis by default.

## ADR-005 — Elysia 2 backend

**Status:** Accepted with known compatibility risk

Elysia 2 is the chosen API framework.

Production runtime is Cloudflare Workers.

Known risk:

- Elysia 2 is currently beta;
- Cloudflare Worker adapter is currently experimental/version-sensitive.

A blocker must be reproduced/documented. Do not silently change frameworks.

## ADR-006 — Next.js on Cloudflare Workers

**Status:** Accepted direction

Use Next.js + React + TypeScript.

Use the current Cloudflare-recommended vinext path when compatible with selected versions.

Compatibility must be verified before relying on version-sensitive features.

## ADR-007 — Neon PostgreSQL + Hyperdrive + Drizzle

**Status:** Accepted

Primary database: Neon PostgreSQL.

Connection:
Cloudflare Worker -> Hyperdrive -> Neon.

ORM:
Drizzle.

Prefer a direct/unpooled Neon connection when creating Hyperdrive.

Prefer `pg` / node-postgres where compatible with the selected Drizzle/Workers configuration.

## ADR-008 — SQL efficiency is a core engineering requirement

**Status:** Accepted

LoveChapter must use efficient SQL/data-access patterns from the start.

Required practices include:

- avoid N+1;
- no unbounded lists;
- select only needed columns;
- query/index design based on access patterns;
- tenant filtering in SQL;
- cursor pagination for large/growing lists when practical;
- batching/set-based operations;
- query-plan inspection for important/non-trivial queries;
- avoid unnecessary Worker/database round trips.

See `docs/DATABASE_GUIDELINES.md`.

## ADR-009 — No custom domain yet

**Status:** Accepted

No custom domain is currently owned.

`lovechapter.tech` is a candidate only.

Use Cloudflare `*.workers.dev` URLs until domain registration/configuration is explicitly confirmed.

## ADR-010 — Notifications are provider-independent

**Status:** Accepted

Core:

- in-app;
- email;
- Web Push.

Optional:

- SMS;
- WhatsApp;
- LINE.

Do not embed provider-specific logic throughout the domain.

## ADR-011 — No Redis by default

**Status:** Accepted

Prefer appropriate Cloudflare primitives. Add Redis only after a demonstrated requirement.

## ADR-012 — First-slice version baseline

**Status:** Accepted for the first MVP slice

The verified baseline on 2026-09-21 is:

- Next.js `16.3.5`, React `19.3.0`, vinext `1.0.0-beta.10`, and
  `@vinext/cloudflare` `1.0.0-beta.8`;
- Tailwind CSS `4.3.3` with its PostCSS adapter for native Next builds and its
  first-party Vite adapter for vinext builds;
- Elysia `2.0.0-beta.16` and TypeBox `1.3.34`;
- Drizzle ORM `0.45.3`, Drizzle Kit `0.31.11`, and node-postgres `8.23.0`;
- Wrangler `4.135.0`, Vite `8.3.0`, TypeScript `6.0.3`, and Node.js 24.

The versions are exact pins for reproducibility, not approval to bypass future
compatibility checks when upgrading.

`vinext check` reports 92% compatibility, zero issues, and one partial item:
vinext does not yet wrap App Router roots for the explicit `reactStrictMode`
option; Next.js itself enables strict mode for the App Router by default.

Elysia `2.0.0-beta.16` does not publish the currently documented
`elysia/adapter/cloudflare-worker` export. The slice therefore uses Elysia 2's
Web Standard adapter, which is compatible with the Workers fetch model. The
same beta also requires a localized TypeBox compiler registration because it
looks for the compiled-validator shape on the wrong TypeBox namespace. These
workarounds live only in `apps/api/src/elysia-typebox.ts` and the app adapter
selection; reassess and remove them when a compatible Elysia 2 release is
available. Elysia remains the backend framework.

## ADR-013 — Authentication boundary remains fail-closed

**Status:** Accepted for the first MVP slice

The application defines a server-side identity provider boundary. Development
identity is accepted only when `AUTH_MODE=development` and is populated from
Worker environment configuration. `AUTH_MODE=disabled` is the deployment
default and all protected routes return an authentication error. Browser
headers are never an identity source.

This is not production authentication. Selecting and integrating the production
provider remains an open product/architecture decision.

## ADR-014 — Invitation URLs are excluded from request telemetry

**Status:** Accepted for the first MVP slice

Guest invitation tokens are bearer credentials carried in URL paths. Cloudflare
invocation logs and traces are disabled for both Workers so those paths are not
captured by automatic request telemetry. Application logging must never emit a
raw invitation token or unredacted invitation URL.

This does not prohibit operational observability. Structured application events
may be added when they omit or irreversibly redact credentials. Any future
request-level logging or tracing must establish and verify token redaction before
it is enabled.

## ADR-015 — Clerk provides authenticated-user sessions

**Status:** Accepted for the first MVP slice

Clerk is the authentication and session provider for couples, planners, and
future account collaborators. Registration is open to everyone through Google
or a verified-email one-time code; password authentication is disabled. Guests
remain account-free and continue to use high-entropy invitation URLs.

Clerk proves the external identity only. Local PostgreSQL records remain
authoritative for profile onboarding, wedding membership, roles, ownership,
and future billing ownership. Clerk Organizations are not used. The API derives
the Clerk subject and verified primary email from a server-verified session
token, then scopes every wedding-owned operation with local data; it never
trusts browser-supplied user, wedding, role, or ownership values.

The API verifies bearer session tokens without a per-request Clerk network call
by calling `@clerk/backend`'s `verifyToken()` with `CLERK_JWT_KEY`, constrains
tokens to the exact configured `PUBLIC_WEB_ORIGIN` through
`authorizedParties`, and requires the expected subject and primary-email
claims. The required custom session claim is
`{ "primaryEmail": "{{user.primary_email_address}}" }`.

The exact initial SDK pins are `@clerk/nextjs` `7.9.4` and `@clerk/backend`
`3.18.1`. `vinext check` reports Clerk's Next.js package as partially compatible
because vinext does not implement Clerk's server-side `auth()` helper. This
slice deliberately avoids that surface: the web uses Clerk's client hooks and
prebuilt sign-in/sign-up components, while the separate Elysia API uses
`@clerk/backend`. Reassess compatibility before introducing Clerk server helpers
inside the Next.js application.
