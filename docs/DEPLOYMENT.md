# LoveChapter — Deployment

## Current status

The approved production architecture is documented, but the Bun/VPS runtime,
first-party authentication, job process, deployment assets, and provider
configuration are not implemented or provisioned yet. Do not treat this file as
evidence of a live deployment.

No custom domain is registered. The owner intends to register
`lovechapter.net`, but ownership, DNS, and TLS remain unconfirmed. Keep all
origins and hostnames configurable and never hardcode or claim that domain.

## Approved production topology

```text
Browser
  -> Next.js/vinext frontend on Cloudflare Workers
  -> same-origin /api/* server proxy
  -> configured HTTPS VPS backend origin
  -> host reverse proxy
  -> Elysia 2 on Bun 1.4.2 at a loopback-only port
  -> bounded direct pg.Pool
  -> Neon PostgreSQL

Separate Bun 1.4.2 job process
  -> separately bounded direct pg.Pool
  -> Neon auth email outbox
  -> Resend through standard fetch
```

Cloudflare Workers remain the frontend target. A backend Worker, Hyperdrive,
Cloudflare Queues, and Worker Cron are not production targets for the approved
backend design.

## Frontend Worker

The frontend uses Next.js, vinext, and the Cloudflare Workers runtime. The
suggested Worker name is `lovechapter-web`.

Until a custom domain is verified, the frontend may use the generated URL
reported by deployment, typically:

```text
https://lovechapter-web.<actual-cloudflare-account-subdomain>.workers.dev
```

Never invent the account subdomain or claim a URL that was not present in real
deployment output.

The browser calls only the public web origin. A server-only route handler
proxies approved `/api/*` traffic to one configured HTTPS backend origin. The
proxy must:

- keep the backend origin and private ingress credential out of browser assets;
- remove inbound spoofed internal/forwarding headers;
- add only trusted proxy metadata;
- forward only allowlisted request and response headers;
- preserve every approved `Set-Cookie` response;
- avoid following upstream redirects automatically;
- force auth responses to remain uncacheable.

The private ingress credential proves that a request passed through the trusted
frontend proxy. It is not user identity and never replaces session
authentication or authorization.

## Bun/VPS backend

The production backend consists of two unprivileged, separately supervised
processes on the same deployment:

- `lovechapter-api` — always-on Elysia 2 HTTP process on Bun 1.4.2;
- `lovechapter-jobs` — Bun 1.4.2 background-job and maintenance process.

A host reverse proxy terminates publicly trusted TLS and forwards the configured
backend hostname to the API on a private loopback port. The firewall exposes
only required administration and HTTPS ports. A bare IP, self-signed
certificate, or publicly exposed Bun port is not an approved production path.

The initial supported VPS floor is 2 vCPU and 2 GiB RAM. A smaller host requires
fresh password-hashing, pool, and concurrent-request validation. Bun upgrades
must repeat runtime, Elysia, crypto, database, and contract checks.

The API must stop accepting new application traffic, drain in-flight requests,
and close its database pool during graceful shutdown. The job process must stop
claiming work, drain its bounded in-flight jobs, and close its own pool.

## Database connections

Both backend processes connect directly to Neon/PostgreSQL over TLS with
process-wide bounded `pg.Pool` instances:

- API default maximum: 6 connections;
- job-process default maximum: 2 connections.

Use a separate least-privilege migration credential for schema changes. Do not
create a pool per request or repository, and do not layer another database
transport over these direct pools.

## Authentication and email

The fail-closed modes are:

- `AUTH_MODE=disabled` — protected routes reject authentication;
- `AUTH_MODE=development` — complete environment-only development identity;
- `AUTH_MODE=local` — first-party verified-email/password accounts and
  database-backed sessions.

Keep `disabled` as the checked-in default. Production must reject
`development`, and `local` must not be enabled until migrations, cryptographic
keys, exact origins, the proxy ingress credential, and Resend configuration are
present.

Production sessions use a host-only `__Host-lovechapter_session` cookie with
`Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and no `Domain` attribute.
Local HTTP development uses a different non-production cookie name.

Resend is a replaceable transactional-email transport, not an identity
provider. Production email remains blocked until the sender/domain is verified.
Verification/reset work must be persisted atomically with its token metadata,
then sent by the bounded job process after commit.

## Secrets and configuration

Do not commit database URLs, password hashes, session secrets, action-token
keys, rate-limit keys, proxy credentials, provider keys, cookies, or real email
addresses.

The implementation plan defines these production configuration groups:

```text
API: DATABASE_URL, DATABASE_POOL_MAX, AUTH_MODE, PUBLIC_WEB_ORIGIN,
     WEB_PROXY_SHARED_SECRET, RATE_LIMIT_HMAC_KEY,
     AUTH_TOKEN_ACTIVE_KEY_VERSION, AUTH_TOKEN_HMAC_KEYS, HOST, PORT
JOBS: DATABASE_URL, DATABASE_POOL_MAX, PUBLIC_WEB_ORIGIN,
      AUTH_TOKEN_ACTIVE_KEY_VERSION, AUTH_TOKEN_HMAC_KEYS,
      RESEND_API_KEY, RESEND_FROM_EMAIL
WEB: API_UPSTREAM_ORIGIN, WEB_PROXY_SHARED_SECRET
```

Exact parsing, validation, example files, service units, and rotation procedures
are implementation work in later approved-plan tasks. Do not create placeholder
production secrets or weaken startup validation to make deployment proceed.

## Logging and telemetry

Guest invitation tokens remain bearer credentials in URL paths. Verification
and reset secrets are also sensitive. Keep raw request/access logging disabled
until a tested redaction layer removes invitation paths, cookies, email
addresses, proxy credentials, client addresses, and action tokens.

Application logs may contain named events and sanitized reason codes only. They
must not contain passwords, cookies, authorization values, raw tokens,
token-bearing URLs, raw IP addresses, full email addresses, or provider response
bodies.

## Deployment gates

Production deployment is blocked until all of the following are real and
verified:

1. reviewed migrations, unique constraints, and access-pattern indexes;
2. production-policy scrypt benchmark on pinned Bun 1.4.2 and the selected VPS;
3. confirmed frontend and backend HTTPS origins;
4. stable backend hostname with a publicly trusted certificate;
5. non-committed high-entropy action-token, rate-limit, and ingress secrets;
6. verified Resend sender/domain and production credentials;
7. generic enumeration-resistant auth responses and bounded rate limiting;
8. bounded, idempotent outbox claims, retries, and cleanup;
9. passing Bun API/job and frontend Worker contract/build checks;
10. staged proxy, cookie, graceful-restart, job-recovery, and pool-exhaustion
    smoke tests;
11. token-safe logging verification;
12. backup, rollback, firewall, and secret-rotation procedures.

No VPS, Neon production database, Resend production sender, custom domain, or
deployed URL is claimed by the repository at this stage.

## Later custom domain

Only after ownership is verified:

1. update `PROJECT_CONTEXT.md`;
2. add or amend an ADR in `docs/DECISIONS.md`;
3. configure DNS, TLS, and Cloudflare custom routes;
4. update exact public/upstream origins;
5. review cookie, proxy, CORS/origin, and redirect policies;
6. run the full staged security and deployment gates again.
