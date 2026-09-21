# LoveChapter — Database & SQL Guidelines

## Goal

LoveChapter uses Neon PostgreSQL through Cloudflare Hyperdrive and Drizzle ORM.

The ORM is a tool, not a substitute for SQL design.

Every engineer/agent must care about:

- correctness;
- tenant isolation;
- query efficiency;
- predictable growth;
- minimum unnecessary database round trips.

---

## 1. Connection architecture

Production path:

Cloudflare Worker
-> Hyperdrive
-> Neon PostgreSQL

Preferred:

- Drizzle ORM
- `pg` / node-postgres where compatible
- direct/unpooled Neon connection configured behind Hyperdrive

Do not layer the Neon serverless driver over Hyperdrive unless current official integration explicitly requires or justifies it.

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
- smaller Worker memory usage;
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

---

## 14. Query round trips

Workers may execute globally while Neon is regional.

Reduce unnecessary round trips.

Prefer:

- one well-designed query;
- small fixed query counts;
- batching;

over chains of dependent queries when they can be safely combined.

Do not contort simple code into unreadable mega-SQL merely to remove one cheap query. Measure important cases.

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
- backward compatibility during deploy;
- safe rollback/forward-fix strategy.

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
- Are transactions short?
- Are constraints enforcing invariants?
- Did we inspect generated SQL?
- Did we review the query plan for important queries?
- Does this still behave efficiently with 10x/100x more rows?

Database efficiency is part of feature correctness for LoveChapter.
