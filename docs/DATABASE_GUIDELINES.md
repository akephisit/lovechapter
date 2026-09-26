# LoveChapter — Database & SQL Guidelines

## Goal

LoveChapter uses Neon PostgreSQL through `pg` / node-postgres and Drizzle ORM.
VPS deployments use bounded direct pools; Worker deployments use Hyperdrive
and a client scoped to each invocation.

The ORM is a tool, not a substitute for SQL design.

Every engineer/agent must care about:

- correctness;
- tenant isolation;
- query efficiency;
- predictable growth;
- minimum unnecessary database round trips.

---

## 1. Connection architecture

VPS production path:

Elysia API and background-job processes on Bun/VPS
-> separately bounded `pg.Pool` instances
-> Neon PostgreSQL

Preferred:

- Drizzle ORM
- `pg` / node-postgres
- direct TLS Neon/PostgreSQL connection
- one process-wide pool per backend process
- initial maximum of 6 API connections and 2 job-process connections

Worker production path:

API fetch/scheduled invocation on Cloudflare Workers
-> one lazy `pg.Client` via Hyperdrive per invocation
-> Neon PostgreSQL

The Hyperdrive configuration **must disable query caching**. Auth state,
membership checks and writes require fresh reads; a cached SELECT can retain
permissions after revocation or hide a newly verified account.

Close scheduled Worker clients in `finally`; for HTTP responses close the
client after a streamed body finishes or is canceled, including CSV exports
that query lazily. Never create a global Worker client or a pool per request.
Migrate outside Workers with a separate direct PostgreSQL URL. VPS pool-size
changes require measurement against concurrency and Neon connection budgets;
do not multiply pools per repository.

---

## 2. Tenant scoping

Every query touching wedding-owned data must be scoped correctly.

Bad conceptual pattern:

`SELECT ... FROM guests WHERE id = $guestId`

Preferred conceptual pattern when authorization depends on wedding:

`SELECT ... FROM guests WHERE id = $guestId AND wedding_id = $authorizedWeddingId`

Do not fetch cross-tenant rows and filter them in application memory.

---

## 3. Select only what is needed

Avoid application-path `SELECT *`.

Select required columns only.

Benefits:

- less database work;
- less network transfer;
- smaller application memory usage;
- clearer authorization/data exposure.

---

## 4. Avoid N+1

Do not:

1. fetch 100 guests;
2. run one query per guest for RSVP;
3. run another query per guest for table.

Prefer:

- joins;
- relation-aware queries;
- batched `IN (...)` queries when bounded;
- aggregated subqueries;
- a small fixed number of queries.

When reviewing a list screen, estimate total SQL statements, not just code readability.

---

## 5. Bounded queries

All list endpoints must have explicit practical bounds.

Do not return an unlimited number of:

- guests;
- weddings;
- tasks;
- vendors;
- notifications;
- documents.

For growing collections, implement pagination.

---

## 6. Pagination

Prefer keyset/cursor pagination for large/growing frequently-used lists.

Common pattern:

`WHERE (created_at, id) < ($cursorCreatedAt, $cursorId)`
`ORDER BY created_at DESC, id DESC`
`LIMIT $limit`

Use deterministic tie-breakers.

OFFSET pagination can be used when:

- result sets are intentionally small;
- admin UX needs random page access;
- performance has been measured and is acceptable.

---

## 7. Index design

Indexes must follow actual query patterns.

Evaluate indexes for:

- tenant/wedding scope;
- foreign-key joins;
- common filters;
- common ordering;
- uniqueness.

Do not copy indexes mechanically.

Avoid:

- duplicate indexes;
- indexes that are never used;
- indexing every column;
- excessive write amplification;
- composite indexes with arbitrary column order.

Sequential scans are not inherently wrong on tiny tables.

---

## 8. Foreign keys and constraints

Use database constraints for invariants that must remain true under concurrency.

Consider:

- foreign keys;
- NOT NULL;
- UNIQUE;
- CHECK;
- appropriate delete/update behavior.

Remember: PostgreSQL does not automatically create every useful index on referencing foreign-key columns. Evaluate indexes based on join/delete/filter patterns.

---

## 9. Existence and counts

If only existence is needed, prefer `EXISTS` rather than counting every matching row.

Do not calculate full counts on hot paths unless the product actually needs them.

---

## 10. Aggregation

Prefer PostgreSQL for set-based aggregation when it avoids transferring large row sets.

Do not fetch thousands of rows to JavaScript merely to:

- count;
- sum;
- group;
- filter;
- sort.

---

## 11. Batch writes

Avoid one write query per row in loops for bulk operations.

Prefer:

- multi-row insert;
- batched update strategy;
- PostgreSQL set-based operations.

For data-dependent work, do not replace a write loop with unbounded
`Promise.all`. Use a set-based statement where practical or an explicit small
concurrency limit where operations are genuinely independent.

---

## 12. Transactions

Use transactions when multiple changes must commit atomically.

Keep transactions:

- short;
- focused;
- free from external network/API calls.

Do not hold a database transaction open while calling:

- email providers;
- payment APIs;
- AI APIs;
- other external services.

---

## 13. Concurrency

Where concurrent edits can occur:

- rely on database constraints;
- use atomic updates;
- use appropriate transaction isolation/locking only when required.

Avoid application-level "check then insert" logic when a UNIQUE constraint can enforce correctness.

Keep operations that share one transaction or database client sequential.
Parallelize only independent work, and ensure the combined concurrency cannot
exhaust either process pool. Parallelism must not hide an N+1 query pattern.

Retryable background work must be durable and idempotent. Claim outbox work in
bounded, deterministically ordered batches using leases and, where appropriate,
`FOR UPDATE SKIP LOCKED`. Cleanup statements must also have explicit limits and
stable tie-breakers so later loop iterations can continue safely.

---

## 14. Query round trips

The VPS and Neon may be in different regions, and the API and job processes
share a finite database connection budget.

Reduce unnecessary round trips.

Prefer:

- one well-designed query;
- small fixed query counts;
- batching;

over chains of dependent queries when they can be safely combined.

Do not contort simple code into unreadable mega-SQL merely to remove one cheap query. Measure important cases.

Use asynchronous database APIs. Add timeouts and cancellation where the driver
and operation support them, and aggregate independent failures without losing
which bounded operation failed.

---

## 15. Query-plan review

For non-trivial/high-frequency queries:

1. inspect generated SQL;
2. inspect expected row counts;
3. confirm relevant index support;
4. test with representative data;
5. use query plans.

Useful tools:

- `EXPLAIN`
- `EXPLAIN (ANALYZE, BUFFERS)` for safe SELECT queries in development/staging

Important:

- `EXPLAIN ANALYZE` executes the query;
- do not use it casually on production writes;
- query plans on tiny seed data may not represent production behavior.

---

## 16. Drizzle-specific expectation

Drizzle queries must still be reviewed as SQL.

When a Drizzle abstraction:

- creates too many round trips;
- hides an N+1;
- generates inefficient SQL;
- makes a critical query unnecessarily complex;

it is acceptable to use carefully written parameterized SQL through Drizzle/driver for that specific query.

Raw SQL must:

- be parameterized;
- be tested;
- be documented when non-obvious.

---

## 17. Migration quality

Every migration should be reviewed for:

- locking implications;
- table rewrite risk;
- index build cost;
- null/default behavior;
- one-time transformation and validation of retained data;
- whether the selected installation needs a write/job cutover gate;
- backup/PITR readiness and a tested restore or reviewed forward-fix strategy.

Do not retain legacy columns/tables, dual writes, or duplicate query paths
solely to keep old binaries compatible during deployment. A breaking migration
may replace the old structure in one coordinated release, but must not silently
discard existing user data. Keep old application processes and cron/job workers
away from the migrated schema. If that isolation cannot be enforced, do not
apply the breaking migration. Do not assume a code rollback reverses SQL.

---

## 18. Performance review checklist

Before merging a data-heavy feature, ask:

- Is every query tenant-scoped?
- Is any list unbounded?
- Is there an N+1?
- Are we selecting unnecessary columns?
- Can filtering/sorting happen in SQL?
- Is pagination deterministic?
- Does the query need an index?
- Are there redundant indexes?
- Could this use EXISTS instead of COUNT?
- Are multiple round trips unnecessarily serialized?
- Are parallel operations truly independent and explicitly bounded?
- Does combined API/job concurrency remain within the database connection budget?
- Are transactions short?
- Is every retryable job durable and idempotent?
- Are job claims and cleanup statements bounded and deterministically ordered?
- Are constraints enforcing invariants?
- Did we inspect generated SQL?
- Did we review the query plan for important queries?
- Does this still behave efficiently with 10x/100x more rows?

Database efficiency is part of feature correctness for LoveChapter.

---

## 19. Authentication and outbox invariants

Authentication paths have stricter concurrency requirements than ordinary
profile writes:

- normalize email once and enforce uniqueness with `auth_accounts.email_key`;
- keep pending registration, local-user seeding, action-token replacement, and
  email-job insertion in one short transaction;
- create sessions with a credential-version and observed-password-hash guard so
  a concurrent reset cannot publish a stale session;
- consume verification/reset tokens with account, purpose, hash, expiry, and
  unconsumed predicates in the database;
- reset passwords, increment credential version, and revoke every active
  session in one transaction;
- claim no more than 10 jobs with stable due ordering, leases, and
  `FOR UPDATE SKIP LOCKED`;
- use the persisted job idempotency key for provider calls and guard completion
  updates with the exact lease timestamp;
- delete expired auth state in bounded, deterministically ordered batches.

Raw passwords, session tokens, action-token MACs, raw client addresses, and
complete token-bearing URLs must never be selected for diagnostics or logged.
Only hashes/metadata required by the operation belong in PostgreSQL.

Generated SQL contract tests, `drizzle-kit check`, and the disposable PostgreSQL
integration suite are CI merge gates. Representative live query plans remain a
staging gate. Any manual rerun of the integration suite must target a confirmed
disposable database, never an inferred `DATABASE_URL`.
