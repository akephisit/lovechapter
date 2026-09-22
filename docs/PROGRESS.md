# LoveChapter — Progress

## Current phase

The approved Bun/VPS backend migration and first-party authentication vertical
slice are implemented. The repository includes buildable API/job artifacts,
the same-origin web proxy, account UI, provider-free tests, example systemd and
Caddy assets, and an operational handoff.

This is locally verified code, not a production deployment. No VPS, custom
domain, Neon production database, Resend sender, or live URL is provisioned or
claimed.

## Implemented

- Bun 1.4.2 API runtime with bounded request/body/time limits, graceful drain,
  readiness, and fail-closed validated configuration
- Separate bounded Bun auth-email job process with leases, retries,
  idempotency, terminal failures, and retention cleanup
- First-party verified-email/password accounts using production-policy scrypt
  with a global concurrency cap of two
- Versioned HMAC action tokens, hashed session secrets, secure production
  cookies, all-session password-reset revocation, and bounded database rate
  limits
- Five auth/outbox tables plus generated migration, constraints, and
  access-pattern indexes
- Bounded direct PostgreSQL pools: API maximum 6, jobs maximum 2
- Next.js/vinext same-origin server proxy with strict path/header policy, body
  cap, cookie forwarding, server-only upstream credentials, HTTPS-only remote
  origins, and `no-store` API responses
- Account/session provider, sign-up/sign-in/verification/reset UI, Unicode-safe
  password handling, and immediate fragment scrubbing
- Wedding, guest, private invitation, account-free RSVP, and couple-visible
  response flow
- Conservative service worker with no fetch interception or data caching
- Provider-free in-process vertical-slice proof and browser isolation
  regressions
- Scrypt benchmark command with p50/p95/max/RSS output and a 750 ms p95 gate
- Hardened example systemd services, Caddy TLS proxy config, secret rotation,
  rollback, backup, firewall, and atomic-release guidance

## Local validation

Task 10 validation on 2026-09-22 passed:

- format and lint;
- TypeScript checks for every workspace;
- 44 test files / 217 tests;
- Drizzle migration snapshot check;
- Bun API/jobs builds;
- native Next production build;
- vinext compatibility check at 94%, zero issues and one documented partial
  `reactStrictMode` item;
- vinext production build;
- active-source legacy-provider/deprecated-config scan with zero matches.

Task 11 added benchmark unit coverage and produced this local-runner result:

```json
{
  "benchmark": "scrypt",
  "p50Ms": 316.84606699999995,
  "p95Ms": 380.91432699999996,
  "maxMs": 402.899176,
  "samples": 20,
  "maxConcurrent": 2,
  "rssMiB": 49.2
}
```

Task 11's complete local validation also passed formatting, lint, every
workspace typecheck, 46 test files / 220 tests, Drizzle snapshot validation,
API build and Bun smoke, the benchmark budget, jobs build, native Next build,
vinext compatibility/build, Cloudflare deployment dry-run, and
`git diff --check`. `systemd-analyze verify` accepted both unit structures and
reported only that the deployment-path `/usr/local/bin/bun` is intentionally
absent on this development runner.

Task 12's whole-branch review found and fixed session refresh write
amplification, durable-email shutdown dequeueing, persisted idempotency-key
use, and plaintext remote-origin acceptance. Focused regression coverage and
the final release gate passed on 2026-09-22: formatting, lint, every workspace
typecheck, 46 test files / 229 tests, Drizzle snapshot validation, API/jobs and
vinext builds, Bun runtime smoke, native Next build, vinext compatibility at
94% with zero issues, and Cloudflare deployment dry-run. The final benchmark
reported p50 `279.59 ms`, p95 `362.25 ms`, maximum `378.92 ms`, concurrency 2,
and RSS `48.7 MiB`, within the 750 ms p95 budget.

The benchmark numbers describe only the current development runner. No
`TEST_DATABASE_URL` or confirmation flag was configured, so the live PostgreSQL
concurrency suite and representative query plans remain explicit staging gates.

## External gates

- ownership, DNS, public TLS, and exact origins for the intended domain
- VPS provider/region/sizing and the Bun benchmark on that selected host
- Neon region, disposable staging credentials, live concurrency suite, and
  representative query plans
- Resend sender/domain verification and end-to-end delivery/reputation controls
- staged proxy/cookie, graceful-restart, lease-recovery, pool-exhaustion,
  firewall, rollback, backup-restore, and token-redaction exercises
- internationalized-email policy, MFA, email-address change/reverification,
  and support/admin authentication decisions

See `docs/DEPLOYMENT.md` and `docs/OPEN_QUESTIONS.md`. Update this document after
each significant implementation or deployment session.
