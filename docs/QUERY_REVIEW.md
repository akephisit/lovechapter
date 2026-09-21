# LoveChapter — First-slice query review

**Review date:** 2026-09-21
**Scope:** `PostgresLoveChapterRepository` and the first MVP migration

All statements are parameterized Drizzle SQL with explicit projections. Lists
are bounded to a caller limit of 1–100 and request `limit + 1` rows to derive a
keyset cursor. Tenant checks are performed in SQL. No repository path performs
per-row database work.

## Access-path review

| Repository method      |                                            Expected result cardinality | Scope/filter and joins                                                                                                                  | Order/bound                                                                              | Index or constraint support                                                                          |             SQL statements |
| ---------------------- | ---------------------------------------------------------------------: | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------: |
| `syncUser`             |                                                              exactly 1 | Upsert by `(auth_provider, auth_subject)`; returns only local identity fields                                                           | one row                                                                                  | `users_auth_identity_unique`                                                                         |                          1 |
| `updateUserProfile`    |                                                              exactly 1 | Update by resolved local `users.id`; returns only local identity fields                                                                 | one row                                                                                  | users primary key                                                                                    |                          1 |
| `listWeddings`         |                                          0–101 fetched; 0–100 returned | `wedding_members.user_id = $user`; inner join to `weddings` by PK                                                                       | `(wedding_members.created_at, wedding_members.wedding_id) DESC`; keyset `<`; `limit + 1` | `wedding_members_user_created_idx (user_id, created_at DESC, wedding_id DESC)` plus wedding PK       |                          1 |
| `createWedding`        |                                               1 wedding + 1 membership | Insert keeps creator, workspace owner, and billing owner distinct; owner membership is separate                                         | not applicable                                                                           | user FKs, wedding PK, membership composite PK                                                        | 2 in one short transaction |
| `listGuests`           | unauthorized 0; authorized-empty one sentinel; otherwise 1–101 fetched | CTE proves `(wedding_id, user_id)` membership; left joins guests and RSVP within the wedding                                            | `(guests.created_at, guests.id) DESC NULLS LAST`; keyset `<`; `limit + 1`                | membership PK `(wedding_id,user_id)`, `guests_wedding_created_idx`, `rsvps_wedding_guest_unique`     |                          1 |
| `createGuest`          |                                                                 0 or 1 | `INSERT … SELECT` from matching membership; no application-side authorization filter                                                    | one row                                                                                  | membership PK; guest composite PK and party-size check                                               |                          1 |
| `createInvitation`     |                                                                 0 or 1 | Guest is matched by `(wedding_id,id)` and joined to caller membership before insert                                                     | one row                                                                                  | guest composite PK, membership PK, token-hash unique, active-invitation partial unique               |                          1 |
| `findPublicInvitation` |                                                                 0 or 1 | Unique token hash; requires unrevoked and unexpired invitation; joins scoped guest/wedding and optional RSVP                            | `LIMIT 1`                                                                                | `invitations_token_hash_unique`, guest composite PK, wedding PK, RSVP `(wedding_id,guest_id)` unique |                          1 |
| `upsertRsvp`           |                                                  exactly 1 outcome row | Token-scoped CTE validates invitation state and guest allowance; set-based upsert returns `saved`, `invalid_party_size`, or `not_found` | `LIMIT 1` outcome                                                                        | token-hash unique, guest composite PK, RSVP `(wedding_id,guest_id)` unique and DB check constraint   |                          1 |

## Worker/database round trips

One API dependency callback owns one lazy `pg` client and closes it in
`finally`. The connection is opened only when the first SQL statement is
executed, so a missing or invalid authenticated identity is rejected before a
Hyperdrive/PostgreSQL connection is opened. Public invitation read and RSVP
write each use one database statement. A protected operation first synchronizes
the trusted identity, then performs the repository operation on the same
client: list/create-guest/create-invitation paths use two statements; wedding
creation uses three statements total because its wedding and owner-membership
writes form an intentional two-statement transaction. `GET /v1/me` uses only
identity synchronization. `PATCH /v1/me` intentionally uses two bounded
statements in the same repository session: one identity synchronization
followed by one primary-key-scoped profile update. It does not make an external
call or open a transaction.

Identity synchronization remains one statement supported by the unique
`(auth_provider, auth_subject)` key. A conflict refreshes the verified email and
update timestamp while preserving the locally chosen display name and
onboarding state.

The guest list retrieves RSVP state through one left join, so guest count does
not affect statement count. Filtering, authorization, ordering, validation of
the invitation state, party allowance enforcement, and pagination remain in
PostgreSQL.

The wedding-list projection carries membership creation time only as an
internal cursor field. The public `WeddingSummary.createdAt` continues to mean
the wedding's own creation time, while pagination follows the member-scoped
index and remains deterministic on `wedding_id`.

## Index cost and invariants

Indexes correspond to current access patterns rather than an attempt to remove
all sequential scans. Foreign keys used for list/join paths have composite or
supporting indexes. Unique constraints enforce stable auth identity, one active
invitation per guest, token-hash uniqueness, and one RSVP per wedding guest.
The invitation and RSVP composite keys prevent cross-wedding guest references.

The nullable `users.onboarding_completed_at` column is read with the resolved
identity or updated by primary key. No onboarding index was added because no
current access path filters or orders users by onboarding state.

The `weddings` owner/creator/billing-owner indexes support future ownership and
billing access; they are distinct because those concepts are deliberately not
collapsed. No additional index was added for tiny-table or hypothetical access
patterns.

## Plan validation status

Generated SQL was inspected and query builders have executable contract tests
for projection, parameters, tenant predicates, cursor predicates, bounds, and
statement count. The generated migration passes `drizzle-kit check`.

`EXPLAIN` and `EXPLAIN (ANALYZE, BUFFERS)` were **not run**: no representative
development/staging Neon database or credentials are available in this
workspace. Run plans with representative cardinalities after provisioning,
without using destructive statements or `EXPLAIN ANALYZE` against production.
The first staging review should cover both list queries, public invitation
lookup, and RSVP upsert.
