# LoveChapter — Open Questions

Do not treat these as settled requirements.

## Branding/domain

- Will `lovechapter.tech` be registered?
- If not, what will the final domain be?
- Final logo/visual identity

Until resolved, use Cloudflare `*.workers.dev`.

## Authentication

- Apple login
- Passkeys
- Whether multifactor authentication becomes mandatory
- Support/admin auth model

Clerk, open registration, verified-email OTP, and Google are accepted in
`docs/DECISIONS.md`. Do not build an ad-hoc password system for the remaining
questions.

## Billing

- Couple pricing
- Pay-per-wedding vs subscription vs hybrid
- Planner Pro pricing/limits
- Free tier limits
- Payment provider(s)
- Taxes/VAT/refunds

## Notifications

- Email provider
- Web Push implementation
- SMS provider
- WhatsApp provider
- LINE scope

## Frontend/runtime

- Upgrade cadence for the exact first-slice Next.js/vinext pins recorded in
  `docs/DECISIONS.md`
- When vinext's partial App Router `reactStrictMode` support becomes complete

## Backend

- When an Elysia 2 release exposes the documented Cloudflare adapter and no
  longer needs the localized TypeBox compiler compatibility shim

## Database

- Neon region
- PostgreSQL Row Level Security decision
- Production query monitoring/observability strategy
- Representative staging query-plan results after Neon/Hyperdrive provisioning

## Product

- Free guest limit
- Custom wedding domains
- Guest invitation recovery
- Advanced seating UX
- AI provider/scope
