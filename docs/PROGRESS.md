# LoveChapter — Progress

## Current phase

First MVP vertical slice and Clerk authentication integration implemented and
locally verified; provider/database provisioning and live staging smoke tests
are pending.

## Implemented

- Product name selected: LoveChapter
- Product vision documented
- Couple / Planner / Guest model documented
- Cloudflare-first direction documented
- Elysia 2 decision documented
- Neon + Hyperdrive + Drizzle decision documented
- SQL/database performance rules documented
- No-custom-domain / `workers.dev` strategy documented
- npm-workspace monorepo with independently deployable web and API Workers
- Next.js 16 App Router Couple workspace and account-free guest RSVP route
- PWA manifest and conservative service-worker registration with no data caching
- Elysia 2 API routes, request validation, configured CORS, and stable errors
- Fail-closed server identity boundary plus environment-only development identity
- Clerk open-registration session flow for Google and verified-email OTP
- Networkless Clerk session-token verification with exact authorized parties
- First-login Unicode profile onboarding and local profile ownership
- Sign-in, sign-up, sign-out, retry, expired-session, and auth-error UI states
- Wedding, membership, guest, invitation, and RSVP application flow
- Six-table Drizzle schema and generated PostgreSQL migration
- Tenant-scoped, parameterized, explicitly projected, bounded repository queries
- Indexed keyset pagination controls for wedding and guest collections
- SHA-256-only invitation-token storage and token-scoped public access
- Retryable transient invitation loading with private invalid/expired states
- Authenticated user visibility plus guest-list RSVP refresh and invitation copy
- Build-time public API-origin validation with no localhost production fallback
- Invitation-token-safe Worker telemetry defaults
- Automated domain, repository, API, and UI coverage
- Local/deployment instructions and per-query/index review

## In progress

- No implementation work is currently in progress

## Not implemented

- Public wedding page
- Notification delivery
- Budget
- Vendors
- Seating
- Payments
- Planner Pro
- Realtime
- AI

## Validation status

Verified on 2026-09-22 with Node.js 24.21 and npm 11.19:

- `npm run format:check` — passed;
- `npm run lint` — passed;
- `npm run typecheck` — passed for all five workspaces;
- `npm test` — 21 files and 139 tests passed;
- `npm run db:check --workspace @lovechapter/database` — migration snapshot passed;
- API Wrangler dry-run — passed, 1,759.08 KiB / 319.05 KiB gzip;
- vinext Worker build — passed for `/`, `/sign-in/:sign-in*`,
  `/sign-up/:sign-up*`, and `/i/:invitationToken`; generated `apps/web/dist`
  contained 2,158,365 bytes of files;
- native Next production build — passed for `/`, catch-all sign-in/sign-up,
  dynamic invitation route, and manifest;
- vinext Cloudflare deployment dry-run — passed without deploying;
- built browser assets contain the configured API origin and no localhost API
  fallback;
- `vinext check` — 86% compatible, five supported items, partial
  `reactStrictMode` and `@clerk/nextjs` support, and zero issues. The unsupported
  Clerk server `auth()` surface is not used.

No provisioned Clerk, deployed Neon/Hyperdrive environment, or representative
credentials were available. Live Google/email-OTP authentication, migration
execution, live end-to-end database testing, and
`EXPLAIN`/`EXPLAIN (ANALYZE, BUFFERS)` were not run. No Cloudflare deployment
was attempted, and no `*.workers.dev` URL is claimed.

The next smallest milestone is provisioning the Clerk production instance,
Neon staging branch, and Hyperdrive binding, then running the migration,
representative query plans, and a deployed end-to-end smoke test.

Update this document after each significant Codex session.
