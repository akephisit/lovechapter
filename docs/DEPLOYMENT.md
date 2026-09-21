# LoveChapter — Deployment

## Current domain status

No custom domain is registered.

`lovechapter.tech` is a candidate only.

Do not configure it yet.

## Current deployment target

Use Cloudflare Workers generated URLs.

Suggested Worker names:

- `lovechapter-web`
- `lovechapter-api`

Expected URL shape after deployment:

- `https://lovechapter-web.<cloudflare-account-subdomain>.workers.dev`
- `https://lovechapter-api.<cloudflare-account-subdomain>.workers.dev`

The exact account subdomain must come from Cloudflare deployment output. Never invent it.

## Configuration

Do not hardcode origins.

Use environment/config values such as:

- `PUBLIC_WEB_ORIGIN`
- `PUBLIC_API_ORIGIN`
- other framework-appropriate public/server variables

Configure CORS intentionally if the browser calls a separate API Worker.

Current variables and bindings:

- API: `PUBLIC_WEB_ORIGIN`, `AUTH_MODE`, `CLERK_PUBLISHABLE_KEY`,
  `CLERK_JWT_KEY`, optional development identity values, and `HYPERDRIVE`;
- web: `NEXT_PUBLIC_API_ORIGIN` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. Both
  are public and must be present in the shell that builds the browser bundle;
  they are deliberately not runtime Wrangler variables.

The checked-in production-safe default remains `AUTH_MODE=disabled`. Set the
deployed API to `AUTH_MODE=clerk` only after every Clerk value and the exact web
origin exist. Never deploy `AUTH_MODE=development` as a substitute.

## Frontend

Target:

- Next.js on Cloudflare Workers

Current direction:

- use the Cloudflare-recommended vinext path when compatible.

Because this is version-sensitive:

- run compatibility checks;
- pin compatible versions;
- record incompatibilities.

## API

Target:

- Elysia 2 on Cloudflare Workers

Validate the current official adapter and build requirements.

At the time this project context was written:

- Elysia 2 is beta;
- Cloudflare adapter is experimental/version-sensitive.

## Database

Production path:

Worker
-> Hyperdrive
-> Neon PostgreSQL

Use a direct/unpooled Neon connection when configuring Hyperdrive.

Use Drizzle + supported PostgreSQL driver from application code.

## Staging/production procedure

No production credentials or deployed URLs are stored in this repository.
Replace every placeholder below with output from the relevant provider; do not
invent an account subdomain.

1. Create or claim separate Clerk development and production instances. In
   both, enable open registration, require verified email, enable email OTP and
   Google, and disable password authentication. Add this compact custom session
   claim in the session-token configuration:

   ```json
   { "primaryEmail": "{{user.primary_email_address}}" }
   ```

   Configure Clerk production with real Google OAuth credentials rather than
   development shared credentials. Keep Apple, passkeys, mandatory MFA, and
   support/admin access disabled or unchanged until their open questions are
   decided.

2. In Neon, create/select the database and a least-privilege role for
   Hyperdrive. Copy a **direct, unpooled** PostgreSQL URL (pooling unchecked).
3. Apply the checked-in migrations using a separate direct migration credential:

   ```bash
   export DATABASE_URL='postgres://MIGRATION_USER:PASSWORD@NEON_HOST:5432/lovechapter?sslmode=require'
   npm run db:migrate --workspace @lovechapter/database
   ```

4. Authenticate Wrangler and create Hyperdrive with the unpooled Neon URL:

   ```bash
   npx wrangler login
   npx wrangler hyperdrive create lovechapter-neon --connection-string='postgres://HYPERDRIVE_USER:PASSWORD@NEON_HOST:5432/lovechapter?sslmode=require'
   ```

5. Replace the all-zero `id` in `apps/api/wrangler.jsonc` with the Hyperdrive ID
   printed by Wrangler. Regenerate binding types:

   ```bash
   cd apps/api
   npx wrangler types --env-interface CloudflareBindings
   cd ../..
   ```

6. Make an initial web/API deployment with authentication disabled if needed to
   learn the two real `*.workers.dev` origins. Configure the web origin and
   allowed redirect URLs in Clerk exactly; do not use the candidate custom
   domain. Set `PUBLIC_WEB_ORIGIN` in the API Worker configuration to that exact
   HTTPS web origin.

7. Provide the production Clerk values to the API Worker through its deployment
   configuration or secrets. The PEM public key comes from the production Clerk
   instance's JWT/session-token settings. Do not commit either value:

   ```bash
   npx wrangler secret put CLERK_PUBLISHABLE_KEY --config apps/api/wrangler.jsonc
   npx wrangler secret put CLERK_JWT_KEY --config apps/api/wrangler.jsonc
   ```

   Then set production `AUTH_MODE=clerk` only after both values and
   `PUBLIC_WEB_ORIGIN` are present. The API uses the exact web origin as the
   token's authorized party.

8. Export the actual API Worker origin and production Clerk publishable key
   before every web build or deployment so vinext can embed them in the browser
   bundle:

   ```bash
   export NEXT_PUBLIC_API_ORIGIN='https://lovechapter-api.ACTUAL_SUBDOMAIN.workers.dev'
   export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY='pk_live_REPLACE_WITH_PRODUCTION_VALUE'
   ```

   The build rejects missing, non-HTTP(S), or path-bearing values rather than
   falling back to localhost. Because the web origin is known only after its
   first deployment, a bootstrap deployment followed by an API origin update
   and web redeploy may be necessary. Keep API CORS restricted to the one
   configured web origin.

9. Verify before deploying:

   ```bash
   export NEXT_PUBLIC_API_ORIGIN='https://lovechapter-api.ACTUAL_SUBDOMAIN.workers.dev'
   export NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY='pk_live_REPLACE_WITH_PRODUCTION_VALUE'
   npm run check
   npm run db:check --workspace @lovechapter/database
   npm exec --workspace @lovechapter/web -- vinext check
   npm run build:next --workspace @lovechapter/web
   ```

10. Deploy only after staging verification is complete:

    ```bash
    npx wrangler deploy --config apps/api/wrangler.jsonc
    npm run deploy --workspace @lovechapter/web
    ```

Record the real `*.workers.dev` URLs from command output. Without logging
credentials or tokens, smoke-test Google registration/sign-in, email OTP,
first-login profile onboarding, sign-out, a protected API failure and success,
and the complete account-free invitation/RSVP flow. Never put Neon credentials
in Wrangler variables: the API connects with
`env.HYPERDRIVE.connectionString`.

Both Workers disable Cloudflare invocation logs and traces because guest
invitation tokens are carried in URL paths. Application logs must likewise
avoid raw request URLs and invitation tokens. Re-enabling request telemetry
requires a reviewed redaction strategy first.

For local API development, `localConnectionString` in the API Wrangler config
connects directly and does not exercise Hyperdrive caching. It may point at
local PostgreSQL or a disposable development Neon branch with required TLS.

## Later custom domain

Only after a domain is actually purchased:

1. update `PROJECT_CONTEXT.md`;
2. add ADR to `docs/DECISIONS.md`;
3. configure Cloudflare custom domain/routes;
4. update public origin variables;
5. update CORS/cookie/security policies;
6. configure redirects from old `workers.dev` URLs only if desired;
7. never assume the candidate `lovechapter.tech` until ownership is confirmed.
