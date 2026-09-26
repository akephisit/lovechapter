# LoveChapter — Query and index review

**Review date:** 2026-09-22
**Scope:** domain repositories, first-party auth, sessions, rate limits, and the
auth-email outbox

Every application statement is parameterized and explicitly projected. Domain
lists accept limits of 1–100 and fetch `limit + 1`; outbox claims are at most 10;
cleanup deletes at most 1,000 rows per table per pass. No path performs per-row
database work.

## Domain access paths

| Operation              |            Expected cardinality | Predicate/order/bound                                                                     | Index or constraint                                                              | Statements / transaction   |
| ---------------------- | ------------------------------: | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------- |
| Sync user              |                       exactly 1 | upsert `(auth_provider, auth_subject)`                                                    | `users_auth_identity_unique`                                                     | 1                          |
| Update profile         |                       exactly 1 | `users.id`                                                                                | users PK                                                                         | 1                          |
| List weddings          |   0–101 fetched, 0–100 returned | member `user_id`; keyset `(created_at,wedding_id) DESC`; `limit + 1`                      | `wedding_members_user_created_idx`, wedding PK                                   | 1                          |
| Create wedding         |  1 wedding + 1 owner membership | resolved user                                                                             | PK/FKs, membership composite PK                                                  | 2 in one short transaction |
| List guests            | unauthorized 0; otherwise 0–101 | membership CTE; wedding scope; keyset `(created_at,id) DESC`; `limit + 1`; left-join RSVP | membership PK, `guests_pkey` or `guests_wedding_active_created_idx`, RSVP unique | 1                          |
| Create guest           |                          0 or 1 | `INSERT … SELECT` from matching membership                                                | membership PK, guest PK/FK                                                       | 1                          |
| Create invitation      |                          0 or 1 | wedding + guest + member; one active invitation                                           | membership/guest keys, partial invitation unique                                 | 1                          |
| Read public invitation |                          0 or 1 | token hash, not revoked, not expired; `LIMIT 1`                                           | invitation token-hash unique, guest/wedding/RSVP keys                            | 1                          |
| Upsert RSVP            |               exactly 1 outcome | token-scoped CTE validates invitation and party allowance                                 | token unique, guest composite PK, RSVP unique/check                              | 1                          |

Protected domain requests first synchronize the local principal, then run the
operation on the same lazy client. This gives two statements for ordinary
protected operations and three for wedding creation. Invalid identity is
rejected before the first database statement. Public invitation/RSVP routes use
one statement and no account identity.

## Auth and outbox access paths

| Operation                                 |   Expected cardinality | Predicate/order/bound                                                                       | Index or constraint                                           | Statements / transaction                                |
| ----------------------------------------- | ---------------------: | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------- |
| Consume rate limit                        |        0 or 1 returned | composite bucket key; guarded increment below limit                                         | `auth_rate_limits_pkey`; expiry cleanup index                 | 1 atomic upsert                                         |
| Sign up / replace unverified registration |         0 or 1 account | unique normalized `email_key`; verified rows cannot update                                  | email-key unique; active-token index; job idempotency unique  | 1 if verified duplicate; otherwise 5 in one transaction |
| Resend verification                       |         0 or 1 account | `email_key`, unverified, `LIMIT 1 FOR UPDATE`                                               | email-key unique                                              | 1 if ineligible; otherwise 4 in one transaction         |
| Forgot password                           |         0 or 1 account | `email_key`, verified, `LIMIT 1 FOR UPDATE`                                                 | email-key unique                                              | 1 if ineligible; otherwise 4 in one transaction         |
| Sign in                                   | 0 or 1 account/session | `email_key LIMIT 1`; credential/version-guarded session insert                              | email-key and session token-hash unique; account-active index | 2 normally; 3 only for guarded rehash                   |
| Find action token                         |                 0 or 1 | token UUID `LIMIT 1`; raw token hash verified in service                                    | token PK; token-hash unique                                   | 1                                                       |
| Verify email                              |                 0 or 1 | token/account/hash/purpose, unconsumed and unexpired                                        | token PK/hash; account PK                                     | 1 atomic CTE after token lookup                         |
| Resolve/refresh session                   |                 0 or 1 | token hash, active, idle/absolute expiry; `LIMIT 1`; refresh at most daily                  | token-hash unique; active expiry indexes                      | 1 atomic CTE                                            |
| Sign out                                  |         0 or 1 updated | token hash; idempotent `coalesce(revoked_at, now)`                                          | token-hash unique                                             | 1                                                       |
| Reset password                            |         0 or 1 account | consume valid reset token, bump credential version, revoke all active account sessions      | token PK/hash; account PK; account-active session index       | token lookup + 3 statements in one reset transaction    |
| Claim email jobs                          |                   0–10 | due, unsent, attempt `< 8`, expired/no lease; `(available_at,id)`; `FOR UPDATE SKIP LOCKED` | `auth_email_jobs_due_idx`; idempotency unique                 | 1 atomic CTE                                            |
| Complete/retry/fail job                   |                 0 or 1 | job ID + exact lease timestamp                                                              | job PK                                                        | 1 guarded update                                        |
| Cleanup                                   |      0–1,000 per table | stable expiry/update ordering and table-specific retention                                  | rate/token/session cleanup indexes; job due/PK                | 4 bounded deletes in one transaction                    |

Registration keeps account, seeded local user, token invalidation/replacement,
and outbox insertion atomic. Password reset locks token consumption, credential
version change, and all-session revocation together. No transaction contains a
network call. Resend happens only after commit, using the persisted
`idempotency_key` value for its provider idempotency header.

## Index and migration review

Migration `0002_custom_auth.sql` adds five auth tables, foreign keys, validation
checks, unique email/session/token/idempotency keys, partial active-session and
active-token indexes, due-job ordering, and bounded-cleanup indexes. Generated
SQL and query-builder contract tests reject `SELECT *`, unbounded claims, and
missing credential/token guards. `drizzle-kit check` passes locally.

The due-job partial index uses `attempt_count < 10`, while the worker's terminal
policy claims only `< 8`; the broader partial index still contains every
claimable row and avoids an otherwise duplicate index. Cleanup uses primary-key
deletion after an ordered bounded subquery.

## Live plan gate

On 2026-09-26, `scripts/staging-query-plan-probe.mjs` ran safe `SELECT`-only
`EXPLAIN (ANALYZE, BUFFERS)` statements against the separate Neon staging-test
branch. A transaction seeded 1,000 weddings and memberships, 20,000 guests
across 10 weddings, 1,000 invitations, 1,000 auth
accounts/sessions/tokens/email jobs, and 10,000 rate-limit buckets (1,000
expired). It was rolled back; a post-run query found zero synthetic users,
accounts, and rate-limit rows. The script refuses to run when the staging and
staging-test hosts match. No production database was queried.

| Representative read            | Execution time | Relevant plan observation                                                   |
| ------------------------------ | -------------: | --------------------------------------------------------------------------- |
| Wedding page                   |       0.853 ms | Sequential scans + sort over 1,000 memberships owned by one user            |
| Guest page                     |       1.305 ms | Membership PK lookup, bitmap index on wedding-scoped guest PK, bounded sort |
| Invitation lookup              |       0.128 ms | Token-hash unique index, guest PK, RSVP unique index                        |
| Account by email               |       0.034 ms | `auth_accounts_email_key_unique`                                            |
| Session by token hash          |       0.043 ms | `auth_sessions_token_hash_unique`, account PK                               |
| Due email jobs                 |       0.035 ms | `auth_email_jobs_due_idx`                                                   |
| Expired rate-limit bucket page |       1.100 ms | Bitmap scan of `auth_rate_limits_expiry_cleanup_idx`, bounded sort          |

These are single-run, warm-cache, synthetic results, not latency guarantees.
Sequential scans are reasonable for small/low-selectivity tables and are not
alone a reason to add indexes. The probe uses representative read shapes rather
than every exact generated statement. Separately, the actual Drizzle-generated
SQL for wedding/guest/CSV-export pages, public invitation, RSVP upsert,
account/session lookups, email-job claim, CSV preview, all four auth cleanup
variants, and guest-import cleanup passed safe `EXPLAIN (FORMAT JSON)` on the
staging-test branch. Those DML/CTE plans were **not** executed with
`EXPLAIN ANALYZE`. The sparse-branch exact plans favored some sequential scans;
the representative probe above supplies the larger-data index evidence.

The remaining query-plan limitation is that exact generated CSV preview/export
and mutation plans were not benchmarked at every possible tenant/cardinality
distribution. Bounded page sizes, index definitions, PostgreSQL integration
tests, and live staging CSV/RSVP behavior have been reviewed; repeat the probe
when real staging data grows rather than adding indexes to eliminate every
small-table scan.

## Release gate admission review (2026-09-26)

The Worker now issues one parameterized `SELECT ops.admit_release_lease($1)`
per admitted HTTP or scheduled batch. The owner-run function takes a shared
lock on the singleton control row, returns null while closed, or inserts one
UUID lease before returning. Lease release is one parameterized `DELETE` by
primary key. There is no per-row application loop, unbounded result, or
network call inside a database transaction. The function replaces the
previous multi-round-trip application transaction and lets the app role work
without control-row `UPDATE` or direct lease `INSERT` privileges.

Safe `EXPLAIN (FORMAT JSON)` on the disposable Neon recovery branch showed
`LockRows → Seq Scan` for the one-row control lookup, a sequential scan for
the one-row mode read, and tiny sequential scans for the empty lease count,
bounded oldest-100 status query, and keyed lease delete. The branch had one
control row and zero leases; these are sparse-branch plans, not latency
measurements or representative high-concurrency plans. The existing primary
keys enforce the singleton and lease identity. No secondary index is
justified by this tiny transient set yet; revisit count/status plans if
real lease cardinality grows. The mutating admission function was not run
under `EXPLAIN ANALYZE`.

The exact corrected Worker SHA reran the seven representative read plans on
`staging-test` with the synthetic transaction rolled back. Single-run
execution times were wedding page 0.918 ms, guest page 1.336 ms, invitation
lookup 0.059 ms, account lookup 0.028 ms, session lookup 0.043 ms, due email
jobs 0.039 ms, and expired rate-limit page 1.128 ms. The relevant invitation,
account, session, due-job, and expiry indexes remained in use; small-table
or low-selectivity scans remained reasonable. These are not production
latency guarantees.

A warm, alternating 40-request direct staging API probe measured p95
53.7 ms for protected release-state (one control read) and 88.3 ms for an
unauthenticated wedding list (admission function, lease release, and auth
rejection). The 34.6 ms difference is **not** an isolated release-gate
overhead estimate: the routes perform different work, and this was not a
production-load benchmark. Admission adds one Worker→PostgreSQL round trip
and release adds one; the function internally locks the singleton and
inserts one lease. A comparable pre-gate p95 baseline for this SHA does not
exist, so no production performance acceptance is inferred from this probe.

## Exact-SHA schema readiness and Worker probe (2026-09-26)

Commit `5718cdc1f70c6b7563ebe8bdb78f8eedd7ca0f28` adds one protected
readiness query against `drizzle.__drizzle_migrations`. It selects only the
latest `id` and matches the compiled latest SQL hash; the staging app role
has column-scoped read privileges on `id` and `hash` only. On the disposable
`staging-test` branch, a safe `EXPLAIN (FORMAT JSON)` of that parameterized
SELECT found ten migration rows and used the
`__drizzle_migrations_pkey`: a backward index-only scan obtains `max(id)`,
then a keyed index scan filters the hash. This is a readiness-path query,
not a per-business-request query or a latency benchmark. A live protected
staging readiness request returned 200 after granting only those columns.

On the exact deployed Worker pair, an alternating warm 20-request-per-route
direct API probe measured p95 92.0 ms for protected release-state and
89.1 ms for unauthenticated wedding listing. The routes do different work;
these values **do not** isolate release-gate overhead or establish a
production-load baseline. The gate still contributes one database admission
round trip and one lease-release round trip per business request. The
earlier seven representative SELECT plans were rerun on `staging-test` with
synthetic data rolled back; no new business-query shape was introduced by
`5718cdc`.

## Automated release-plan gate (disposable branch evidence)

The new `runQueryPlanProbe` takes its direct test URL and confirmation from
environment-scoped secrets, then asks Neon for the expected disposable branch's
read/write endpoint. It rejects a matching active-staging host, and also a
matching production host once that resource exists. A missing production host
is permitted only for the staging-only bootstrap phase; production activation
must supply the verified production host. The probe seeds the representative
fixture inside one transaction, runs only the seven SELECT-shaped
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` statements, checks the reviewed
critical index names, and requires a successful rollback. It does not run
mutating statements under `EXPLAIN ANALYZE` and never connects to production.
The local unit tests prove rejection/rollback behavior. On 2026-09-26 the
new gate also ran on a fresh, expiring Neon branch cloned from
`staging-test`, with provider-verified host and distinct staging/production
hosts. Its seven representative SELECT plans passed: wedding page 1.990 ms,
guest page 1.347 ms, invitation lookup 0.059 ms, account lookup 0.026 ms,
session lookup 0.040 ms, due email jobs 0.046 ms, and expired rate-limit
page 1.020 ms. The guest lookup used `guests_pkey`; invitation, account,
session, due-job, and expiry plans used their reviewed indexes. These are
single-run synthetic measurements, not latency guarantees. A post-rollback
read found zero probe users, accounts, and rate-limit rows. The temporary
branch was deleted after the test; neither active staging nor production
was modified by this probe.

The companion staging jobs check waits for the actual scheduled Worker to
mark a test-account reset-mail job sent and remove one exact expired
`auth_rate_limits` marker. It does not invoke cron manually. Provider
rejection, a missed deadline, or marker-cleanup failure rejects acceptance.
The separate PostgreSQL fake-provider 429→success test passed on that same
disposable branch (1/1). The live probe does not claim to have induced a
Resend failure or observed delivery to a real inbox. The real 1-minute and
15-minute Worker-tick acceptance has not yet run for this release SHA.
