# LoveChapter — Open Questions

Do not treat these as settled requirements.

The first-party auth/runtime implementation is complete locally. The items
below are decisions or external provisioning evidence that the repository
cannot supply by itself.

## Branding/domain

- Will ownership, DNS, and publicly trusted TLS for `lovechapter.net` be
  confirmed?
- If not, what will the final custom domain be?
- Which stable HTTPS hostname will expose the VPS API to the frontend Worker?
- Final logo/visual identity

Until ownership is verified, keep every origin and hostname configurable. The
frontend may use its generated `*.workers.dev` URL; do not hardcode or claim the
intended custom domain.

## Authentication

- Apple login or other social login after the first-party flow is stable
- Passkeys
- Whether multifactor authentication becomes mandatory
- Email-address change and reverification flow
- Support/admin authentication and authorization model
- Exact internationalized-email acceptance and Resend delivery support
- End-user session/device management UI

First-party verified-email/password accounts, database-backed sessions, Resend
as a replaceable email transport, and account-free guest RSVP are accepted in
`docs/DECISIONS.md`. Do not add another production authentication provider or
weaken the approved security gates to answer the remaining questions.

## Billing

- Couple pricing
- Pay-per-wedding vs subscription vs hybrid
- Planner Pro pricing/limits
- Free tier limits
- Payment provider(s)
- Taxes/VAT/refunds

## Notifications

- Resend sender/domain verification and production reputation controls
- Web Push implementation
- SMS provider
- WhatsApp provider
- LINE scope

## Frontend/runtime

- Upgrade cadence for the exact first-slice Next.js/vinext pins recorded in
  `docs/DECISIONS.md`
- When vinext's partial App Router `reactStrictMode` support becomes complete

## Backend/operations

- VPS provider, region, sizing, backup, and recovery ownership
- Production result of the passing Bun 1.4.2 scrypt benchmark on the selected
  VPS class (the local development-runner result is not a substitute)
- Stable HTTPS backend hostname, DNS, certificate, and reverse-proxy ownership
- Production monitoring and token-safe observability strategy
- Upgrade cadence for Bun 1.4.2 and Elysia 2.0.0-beta.16
- When Elysia 2 no longer needs the localized TypeBox compatibility shim

## Database

- Neon region
- PostgreSQL Row Level Security decision
- Production query monitoring/observability strategy
- Representative staging query-plan results after direct-pool provisioning
- Measured API/job pool sizes within Neon and VPS connection budgets
- Disposable Neon staging credentials for a repeat concurrency run and live
  query-plan review

## Product

- Free guest limit
- Custom wedding domains
- Whether and when to add automatic email/QR delivery or guest self-service
  recovery; couple-initiated link replacement and manual sharing are available
- Advanced seating UX
- AI provider/scope
- Wedding-day run sheet conventions: time slots, venue/time-zone changes,
  ownership, and whether to expose a public schedule to guests
