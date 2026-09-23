# LoveChapter — Project Context

## Document role

This file is the primary product and architecture source of truth for LoveChapter.

Status:

- **LOCKED** — agreed direction; do not change silently.
- **DRAFT** — preferred direction; validate before treating as permanent.
- **OPEN** — unresolved.

---

## 1. Product identity

**Product name:** LoveChapter

**Product category:** Global Wedding Planning SaaS

**Positioning:** Web-first platform connecting couples, planners, and guests around one wedding workspace.

### Domain status — LOCKED

No custom domain has been registered yet.

The owner intends to register `lovechapter.net`, but it must **not** be treated as owned or configured until registration is verified.

Until a domain is actually registered:

- use available generated deployment URLs;
- keep public origins configurable through environment variables;
- do not hardcode future custom-domain URLs;
- do not configure redirects to `lovechapter.net`.

Suggested frontend Worker name:

- `lovechapter-web`

Actual deployed URLs depend on the Cloudflare account subdomain and must be discovered from deployment output.

---

## 2. Product vision — LOCKED

Build a global, modern, web-first Wedding Planning SaaS that supports the wedding lifecycle for:

1. Couples
2. Professional wedding planners
3. Guests

These are roles/experiences in one platform, not three unrelated products.

Long-term business models may include:

- B2C — couples planning their own wedding;
- B2B — planners or wedding companies managing multiple client weddings.

The platform must be international-first and must not depend on LINE or another region-specific messaging platform.

---

## 3. User model

### Couple — LOCKED

A Couple:

- has an authenticated account;
- can create/manage a wedding;
- can invite another couple member;
- can invite planners/collaborators;
- can manage wedding data;
- may be the billing owner, but does not have to be.

### Planner — LOCKED / DRAFT

A Planner:

- has an authenticated account;
- can join an invited wedding without paying separately;
- may later subscribe to Planner Pro;
- Planner Pro may create/manage multiple client weddings.

Exact Planner Pro pricing/features remain open.

### Guest — LOCKED

A Guest:

- does not need an account for normal guest flows;
- does not need a password to RSVP;
- enters through secure invitation token / URL / QR;
- can RSVP and update RSVP;
- can view allowed wedding information;
- can view guest-specific information such as their own table;
- can opt into notifications;
- never pays to access a wedding.

Guest route concept:

`/i/{invitationToken}`

Resolution:

`Invitation -> Guest -> Wedding`

Sensitive guest changes may later require email OTP or equivalent verification.

### Guest affiliations — LOCKED

- Affiliations are wedding-defined and are never hardcoded as bride side,
  groom side, or another assumed family structure.
- A wedding member can create, rename, color, order, and delete affiliations.
- A wedding may have at most 100 affiliations, and the limit is enforced before
  a new one is created.
- A guest has zero or one affiliation in the first version.
- Existing guests can be assigned, reassigned, or returned to unassigned.
- Deleting an affiliation preserves every guest and leaves affected guests
  unassigned.
- Tags or multi-group membership are a separate future capability.
- A postal address is not required to create or manage a guest.

### Guest management, data exchange, and printing — LOCKED

The approved design lives in
`docs/superpowers/specs/2026-09-23-guest-management-csv-envelope-design.md`.
Guest management uses optional contact, envelope name, note, and postal address
fields; searchable, filterable active/archive lists; transactional invitation
revocation on archive; restore without reviving links; and bounded atomic bulk
operations. Address remains optional for RSVP, import/export, and name-only
envelopes. CSV export streams the authorized filtered set in 500-row pages
with spreadsheet-formula protection and no invitation secrets. CSV import is
creation-only: a bounded `text/csv` parser stages normalized rows for 24 hours,
previews mapping/errors/duplicates, requires explicit inclusion and duplicate
decisions, and commits once per batch/idempotency key. Expired staging is
cleaned in 500-batch maintenance runs. Browser envelope printing uses 1–500
active guest IDs, optional postal addresses, validated DL/C5/C6/custom
templates, self-hosted Thai fonts, and one text-only page per guest. The
GitHub Actions runs the disposable PostgreSQL integration suite. Representative
staging query plans and a physical-printer acceptance check remain unverified.

---

## 4. Ownership and billing — LOCKED

Keep these concepts independent:

- `created_by`
- workspace owner
- wedding membership role
- billing owner

The wedding creator is not automatically the payer.

Supported examples:

### Couple-led

Couple creates Wedding -> Couple pays -> Couple invites Planner.

### Planner-led

Planner creates Wedding -> Planner/company pays -> Planner invites Couple.

Initial authenticated workspace roles:

- Owner
- Couple
- Planner
- Collaborator

Guests are modeled separately from authenticated workspace membership.

---

## 5. Guest experience — LOCKED

Minimize friction.

Preferred flow:

1. Guest receives URL/QR.
2. Guest opens invitation.
3. High-entropy token identifies invitation.
4. Guest views allowed wedding details.
5. Guest RSVPs without registration.
6. Guest can return using the same invitation link.
7. Guest may opt into notifications.

Do not require normal guests to:

- create account;
- set password;
- install app;
- use LINE;
- log in before viewing invitation.

---

## 6. Notification architecture — LOCKED

Core:

- In-app
- Email
- Web Push

Optional regional providers:

- SMS
- WhatsApp
- LINE
- future channels

LINE is an integration, not a core dependency.

Domain code should emit notification events. Delivery providers should be isolated behind an abstraction.

---

## 7. Product modules — DRAFT

### Planning

- dashboard
- countdown/progress
- checklist
- timeline
- run sheet

### Guests

- guest list
- wedding-defined affiliations
- invitations
- RSVP
- party size / plus-one
- dietary requirements
- seating
- check-in

### Budget

- total budget
- categories
- expenses
- payments
- outstanding balances
- due dates

### Vendors

- vendor records
- contacts
- quotes
- contracts
- payment schedule
- notes

### Seating

- tables
- seat assignments
- grouping
- future visual editor

### Public wedding experience

- wedding website
- schedule
- venue
- maps/location
- dress code
- gallery
- wishes/messages

### Documents

- quotations
- contracts
- receipts
- payment evidence
- related files

### Future AI

- planning assistant
- checklist generation
- timeline suggestions
- translation
- guest Q&A
- document extraction

AI is optional and must not invent wedding-specific facts.

---

## 8. Internationalization — LOCKED

Prepare for:

- multiple languages;
- per-wedding locale;
- per-guest language preference;
- IANA time zones;
- ISO currencies;
- locale-aware dates/times/numbers;
- international phone numbers;
- varying address formats.

Do not hardcode Thai-specific behavior into the core domain.

Store money using a machine-safe amount representation and ISO currency code. Do not persist formatted currency strings as source of truth.

---

## 9. Frontend Worker and Bun/VPS backend architecture — LOCKED

The frontend targets Cloudflare Workers. The backend targets an always-on Bun
process on a VPS, with a separate Bun background-job process.

Do not default to:

- Docker-based production runtime;
- Kubernetes;
- Redis;
- microservices.

Introduce additional infrastructure only for demonstrated needs.

### Frontend — LOCKED DIRECTION

- Next.js
- React
- TypeScript
- App Router
- Tailwind CSS
- shadcn/ui
- PWA-capable
- Cloudflare Workers

Current Cloudflare recommendation for new Next.js Workers applications is vinext. Because vinext is still version-sensitive/beta, Codex must verify compatibility for the actual selected versions before relying on unsupported features.

### Backend — LOCKED

- Elysia 2
- TypeScript
- Bun 1.4.2 production runtime
- always-on VPS HTTP process
- separate Bun background-job process

Elysia 2 is an explicit project decision.

The current Elysia 2 release line is beta and version-sensitive. Its Bun runtime behavior is an accepted project risk that must be actively validated.

Do not silently replace Elysia 2.

### Browser/API boundary — LOCKED

The browser calls only same-origin `/api/*` paths on the frontend Worker. A
server-only route handler proxies approved requests to one explicitly configured
HTTPS backend origin and supplies a rotatable private ingress credential. The
credential authenticates the proxy boundary, not the user; the API still
performs normal session authentication and server-side authorization.

The proxy must keep the backend origin and ingress credential out of browser
assets, remove spoofed forwarding headers, preserve approved `Set-Cookie`
headers, and keep origins configurable. Production requires a stable backend
hostname with publicly trusted TLS; a bare IP or self-signed certificate is not
an accepted production path.

If a blocker occurs:

1. reproduce it;
2. document it;
3. try the smallest safe workaround;
4. record the issue in `docs/DECISIONS.md`;
5. request explicit approval before replacing Elysia.

Prefer Web Platform APIs:

- Request
- Response
- fetch
- Web Crypto
- Streams

Bun-only runtime APIs are confined to API/job bootstrap modules. Domain,
authentication, and repository logic remain runtime-independent where practical.

---

## 10. Database architecture — LOCKED

Primary database:

- Neon PostgreSQL

Access path:

`Bun API/job process -> bounded pg.Pool -> Neon PostgreSQL`

ORM:

- Drizzle ORM

Preferred PostgreSQL driver:

- `pg` / node-postgres with separately bounded API and job-process pools

Use a direct TLS PostgreSQL connection. Hyperdrive and backend Workers are not
production targets.

The initial connection budgets are a maximum of 6 connections for the API
process and 2 for the job process. Changes require measurement against the
deployed Neon and VPS limits.

Use migrations.

Database performance rules are mandatory. See:

`docs/DATABASE_GUIDELINES.md`

Efficient SQL is a product requirement, not an optional optimization.

### Authentication architecture — LOCKED

- LoveChapter owns verified-email/password credentials.
- Email verification is required before sign-in.
- Sessions are database-backed and delivered only through secure HTTP-only cookies.
- Password reset revokes every session for the account.
- Resend is an isolated, replaceable email transport rather than an identity provider.
- Guest invitation and RSVP access remains account-free.
- `AUTH_MODE` supports only `disabled`, `development`, and `local`; production
  must never use `development`.

Clerk and other managed authentication providers are not production targets.

### Asynchronous and parallel work — LOCKED

Use asynchronous APIs for network, database, crypto, and email operations.
Parallel execution is limited to independent work and must be statically bounded
or protected by an explicit concurrency limit. Dependency chains and operations
sharing a transaction/client remain sequential. Retryable background work must
be durable and idempotent, with cancellation, timeouts, and bounded cleanup.
Set-based SQL is preferred over parallel per-row queries; parallelism must never
hide N+1 or unbounded remote work.

---

## 11. Cloudflare supporting services

Use only when the feature needs them.

### R2

For:

- photos
- gallery media
- documents
- contracts
- quotations
- moodboard files

### Durable Objects

For future:

- live check-in
- realtime guest count
- collaborative edits
- WebSocket coordination

### KV

Only for appropriate lightweight cache/config use cases.

KV is not the relational source of truth.

---

## 12. Realtime — DRAFT

Do not make normal CRUD realtime by default.

Potential realtime:

- wedding-day check-in;
- live arrival counters;
- collaborative seating;
- planner/couple live dashboards.

Preferred Cloudflare coordination primitive:

- Durable Objects

Not required for first MVP.

---

## 13. Security and multi-tenancy — LOCKED

LoveChapter is multi-tenant.

Every wedding-owned record must be scoped to the correct wedding/workspace.

Authorization must be enforced server-side.

Never trust client-supplied:

- wedding ID;
- user ID;
- guest ID;
- membership role;
- owner flag;
- billing owner;
- tenant scope.

Validate all external input.

Invitation tokens must be:

- cryptographically strong;
- high entropy;
- unguessable;
- unrelated to sequential database IDs.

Secrets must never be committed.

PostgreSQL Row Level Security is an open defense-in-depth option; do not enable it casually without documenting how it interacts with application authorization and migrations.

---

## 14. Initial data model — DRAFT

Likely entities:

- users
- weddings
- wedding_members
- guests
- guest_groups
- invitations
- rsvps
- tables
- seat_assignments
- vendors
- expenses
- payments
- tasks
- events
- documents
- notifications
- notification_preferences

Do not generate all tables blindly.

Design constraints, access patterns, relationships, indexes, and query patterns before finalizing schema.

---

## 15. First MVP — LOCKED DIRECTION

Prove one complete vertical slice:

Couple identity
-> Create wedding
-> Add guest
-> Create secure invitation
-> Guest opens invitation
-> Guest RSVPs without account
-> Couple sees RSVP state

Include:

- monorepo foundation;
- frontend Cloudflare Worker configuration;
- Bun/VPS API and background-job configuration;
- environment strategy;
- Neon + bounded direct PostgreSQL pools + Drizzle foundation;
- MVP schema/migrations;
- wedding membership/authorization;
- guest management;
- secure invitations;
- public invitation page;
- RSVP;
- basic public wedding page;
- responsive UI;
- tenant isolation;
- input validation;
- automated critical-flow tests;
- efficient SQL and query-plan review for important data paths.

Do not implement yet unless required:

- production billing;
- Planner Pro payments;
- SMS;
- WhatsApp;
- LINE;
- advanced AI;
- advanced seating editor;
- realtime;
- complex analytics.

---

## 16. Engineering priorities

1. Correctness
2. Tenant isolation/security
3. Database/query efficiency
4. Maintainability
5. Simple architecture
6. Type safety
7. Developer velocity
8. Performance under real workloads

Do not over-engineer hypothetical scale, but do not write obviously inefficient SQL or data-access patterns that will become expensive as the product grows.

---

## 17. Open decisions

- Final custom domain and verification of `lovechapter.net` ownership
- Future login methods beyond verified email/password
- Internationalized-email acceptance and Resend delivery support
- Payment provider(s)
- Couple pricing
- Planner Pro pricing/limits
- Free plan limits
- Web Push implementation
- Custom wedding domains
- Guest recovery/verification UX
- Advanced seating UX
- AI provider/scope
- PostgreSQL RLS decision
