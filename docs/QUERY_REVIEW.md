# LoveChapter — Query and index review

**Review date:** 2026-09-22
**Scope:** domain repositories, first-party auth, sessions, rate limits, and the
auth-email outbox

Every application statement is parameterized and explicitly projected. Domain
lists accept limits of 1–100 and fetch `limit + 1`; outbox claims are at most 10;
cleanup deletes at most 1,000 rows per table per pass. No path performs per-row
database work.

## Domain access paths

| Operation              |            Expected cardinality | Predicate/order/bound                                                                     | Index or constraint                                      | Statements / transaction   |
| ---------------------- | ------------------------------: | ----------------------------------------------------------------------------------------- | -------------------------------------------------------- | -------------------------- |
| Sync user              |                       exactly 1 | upsert `(auth_provider, auth_subject)`                                                    | `users_auth_identity_unique`                             | 1                          |
| Update profile         |                       exactly 1 | `users.id`                                                                                | users PK                                                 | 1                          |
| List weddings          |   0–101 fetched, 0–100 returned | member `user_id`; keyset `(created_at,wedding_id) DESC`; `limit + 1`                      | `wedding_members_user_created_idx`, wedding PK           | 1                          |
| Create wedding         |  1 wedding + 1 owner membership | resolved user                                                                             | PK/FKs, membership composite PK                          | 2 in one short transaction |
| List guests            | unauthorized 0; otherwise 0–101 | membership CTE; wedding scope; keyset `(created_at,id) DESC`; `limit + 1`; left-join RSVP | membership PK, `guests_wedding_created_idx`, RSVP unique | 1                          |
| Create guest           |                          0 or 1 | `INSERT … SELECT` from matching membership                                                | membership PK, guest PK/FK                               | 1                          |
| Create invitation      |                          0 or 1 | wedding + guest + member; one active invitation                                           | membership/guest keys, partial invitation unique         | 1                          |
| Read public invitation |                          0 or 1 | token hash, not revoked, not expired; `LIMIT 1`                                           | invitation token-hash unique, guest/wedding/RSVP keys    | 1                          |
| Upsert RSVP            |               exactly 1 outcome | token-scoped CTE validates invitation and party allowance                                 | token unique, guest composite PK, RSVP unique/check      | 1                          |

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
network call. Resend happens only after commit, using the persisted job ID as
its idempotency key.

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

`EXPLAIN` and `EXPLAIN (ANALYZE, BUFFERS)` were not run because this workspace
does not have a confirmed disposable `TEST_DATABASE_URL` or representative
staging data. This remains a deployment gate, not a claimed success. In staging,
review wedding/guest lists, public invitation/RSVP, email lookup, session
resolve, due-job claim, and every cleanup variant at representative 10×/100×
cardinalities. Use `EXPLAIN ANALYZE` only for safe reads outside production.
