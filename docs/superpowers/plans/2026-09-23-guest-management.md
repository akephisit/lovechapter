# Guest Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete wedding-scoped guest workspace: search, filters, stable pagination, create/edit details, recoverable archive/restore, and bounded bulk affiliation/archive actions.

**Architecture:** Extend the shared contracts first, then add the guest and optional postal-address schema, tenant-scoped SQL, repository/service operations, Elysia routes, and focused React components. List responses remain deliberately small; editing loads one authorized guest-detail record. Archive and bulk mutations use short PostgreSQL transactions and reject partial or cross-wedding input.

**Tech Stack:** TypeScript 6.0.3, Elysia 2.0.0-beta.16, Drizzle ORM 0.45.3, PostgreSQL, React 19.3.0, Next.js 16.3.5, Vitest 5.0.1

**Spec:** `docs/superpowers/specs/2026-09-23-guest-management-csv-envelope-design.md`

## Global Constraints

- A guest name is the only required personal-data field.
- Postal address is optional and must never block RSVP, invitation, CSV, or name-only printing.
- A guest has zero or one wedding-defined affiliation; affiliations are never hardcoded and remain capped at 100 per wedding.
- Archive is recoverable, immediately revokes every active invitation, and never reactivates an old invitation during restore.
- Bulk operations accept 1–200 unique guest IDs and are all-or-nothing within one authorized wedding.
- List limits remain 1–100 and use deterministic `created_at DESC, id DESC` keyset pagination.
- Every wedding-owned read and mutation applies membership and wedding scope in SQL.
- Queries select only required columns, avoid N+1 work, and use set-based SQL for bulk changes.
- Bun stays pinned to 1.4.2; no Bun-only API enters contracts, domain, or repository logic.
- User-facing copy stays English-first and Unicode-safe; no Thailand-only address assumptions are introduced.

## Review Focus

- Whitespace-only optional phone, envelope name, note, and address fields normalize to absent values instead of storing meaningless strings; Task 1 pins this in service tests.
- An archived guest's existing invitation becomes unusable immediately and restore does not revive it; Tasks 3 and 4 pin this at repository, service, and API levels.
- A bulk request containing one missing or cross-wedding guest changes nothing; Task 3 pins atomic rejection in unit and PostgreSQL integration tests.
- Cursor traversal under active/archived, affiliation, RSVP, and search filters neither duplicates nor skips equal-timestamp guests; Task 3 pins deterministic SQL and page behavior.
- Omitting `postalAddress` during PATCH preserves it, while explicit `postalAddress: null` removes it; Tasks 1 and 3 pin the distinction.

---

### Task 1: Guest contracts and domain validation

**Files:**

- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/domain/src/ports.ts`
- Modify: `packages/domain/src/service.ts`
- Modify: `packages/domain/src/service.test.ts`
- Modify: `packages/domain/src/testing/in-memory-repository.ts`
- Modify: `packages/domain/src/testing/in-memory-repository.test.ts`

**Interfaces:**

- Consumes: existing `GuestSummary`, `Page<T>`, `PageInput`, and wedding membership boundary.
- Produces: `GuestListInput`, `GuestDetail`, `UpdateGuestInput`, `PostalAddressInput`, `BulkGuestIdsInput`, `BulkGuestAffiliationInput`, and normalized repository inputs used by Tasks 3–5.

- [ ] **Step 1: Extend shared guest contracts**

Add these exact public shapes while retaining backward-compatible `CreateGuestInput` usage:

```ts
export const GUEST_RSVP_FILTER_VALUES = [
  "pending",
  "attending",
  "declined",
] as const;
export type GuestRsvpFilter = (typeof GUEST_RSVP_FILTER_VALUES)[number];
export type GuestView = "active" | "archived";

export type PostalAddressInput = {
  addressLine1: string;
  addressLine2?: string;
  locality?: string;
  administrativeArea?: string;
  postalCode?: string;
  countryCode?: string;
};

export type CreateGuestInput = {
  name: string;
  email?: string;
  phone?: string;
  allowedPartySize: number;
  affiliationId?: string;
  envelopeName?: string;
  note?: string;
  postalAddress?: PostalAddressInput;
};

export type UpdateGuestInput = Partial<
  Omit<CreateGuestInput, "postalAddress">
> & {
  postalAddress?: PostalAddressInput | null;
};

export type GuestListInput = PageInput & {
  search?: string;
  affiliation?: string | "unassigned";
  rsvp?: GuestRsvpFilter;
  view: GuestView;
};

export type GuestDetail = GuestSummary & {
  envelopeName?: string;
  note?: string;
  postalAddress: PostalAddressInput | null;
  updatedAt: string;
};

export type BulkGuestAffiliationInput = {
  guestIds: string[];
  affiliationId: string | null;
};
export type BulkGuestIdsInput = { guestIds: string[] };
export type BulkGuestResult = { affected: number };
```

Replace the current `Omit<CreateGuestInput, ...>` definition of
`GuestSummary`; extending the create input must not accidentally expose note
or address on every list row. Define the list projection explicitly as ID,
name, optional email/phone, party allowance, affiliation, created/archive
timestamps, and RSVP only.

```ts
export type GuestSummary = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  allowedPartySize: number;
  affiliation: GuestAffiliation | null;
  createdAt: string;
  archivedAt?: string;
  rsvp: RsvpResponse | null;
};
```

- [ ] **Step 2: Write failing service tests for normalization and limits**

Add focused cases that assert:

```ts
await service.updateGuest(weddingId, guestId, {
  phone: "   ",
  envelopeName: " คุณสมชายและครอบครัว ",
  note: "  Vegetarian table  ",
  postalAddress: null,
});

expect(repository.lastGuestUpdate).toMatchObject({
  phone: null,
  envelopeName: "คุณสมชายและครอบครัว",
  note: "Vegetarian table",
  postalAddress: null,
});

await expect(
  service.bulkArchiveGuests(
    weddingId,
    Array.from({ length: 201 }, crypto.randomUUID),
  ),
).rejects.toThrow("Bulk guest actions accept 1–200 unique guests");
```

Also cover 120-character names, 320-character email, 40-character phone,
180-character envelope name/address lines, 120-character locality/area,
32-character postal code, two-letter uppercase country code, 2,000-character
note, duplicate IDs, invalid UUID-shaped IDs, omitted-address preservation, and
explicit-address removal.

- [ ] **Step 3: Run the focused tests and confirm RED**

Run:

```bash
npm test -- packages/domain/src/service.test.ts packages/domain/src/testing/in-memory-repository.test.ts
```

Expected: FAIL because the new service and repository methods/types do not yet exist.

- [ ] **Step 4: Add repository ports and service methods**

Add normalized repository types that preserve PATCH presence:

```ts
export type NormalizedGuestUpdate = {
  name?: string;
  email?: string | null;
  phone?: string | null;
  allowedPartySize?: number;
  affiliationId?: string | null;
  envelopeName?: string | null;
  note?: string | null;
  postalAddress?: PostalAddressInput | null;
};

export type GuestListRepositoryInput = RepositoryPageInput & {
  search?: string;
  affiliation?: string | "unassigned";
  rsvp?: GuestRsvpFilter;
  view: GuestView;
};

export interface LoveChapterRepository {
  listGuests(
    userId: string,
    weddingId: string,
    input: GuestListRepositoryInput,
  ): Promise<Page<GuestSummary>>;
  getGuest(
    userId: string,
    weddingId: string,
    guestId: string,
  ): Promise<GuestDetail>;
  updateGuest(
    userId: string,
    weddingId: string,
    guestId: string,
    input: NormalizedGuestUpdate,
  ): Promise<GuestDetail>;
  archiveGuest(
    userId: string,
    weddingId: string,
    guestId: string,
  ): Promise<GuestDetail>;
  restoreGuest(
    userId: string,
    weddingId: string,
    guestId: string,
  ): Promise<GuestDetail>;
  bulkSetGuestAffiliation(
    userId: string,
    weddingId: string,
    guestIds: string[],
    affiliationId: string | null,
  ): Promise<BulkGuestResult>;
  bulkArchiveGuests(
    userId: string,
    weddingId: string,
    guestIds: string[],
  ): Promise<BulkGuestResult>;
}
```

Implement `LoveChapterService.getGuest`, `updateGuest`, `archiveGuest`,
`restoreGuest`, `bulkSetGuestAffiliation`, and `bulkArchiveGuests`. Centralize
normalization in `normalizeGuestCreate`, `normalizeGuestUpdate`,
`normalizePostalAddress`, and `normalizeGuestIds`; use
`Array.from(value).length` for user-visible character limits.

- [ ] **Step 5: Extend the in-memory repository minimally**

Store full guest details and archive state, reject wedding mismatches, revoke
in-memory invitations during archive, leave invitations revoked during restore,
and make bulk methods validate the complete ID set before changing any record.

- [ ] **Step 6: Run focused tests and confirm GREEN**

Run:

```bash
npm test -- packages/domain/src/service.test.ts packages/domain/src/testing/in-memory-repository.test.ts
npm run typecheck --workspace @lovechapter/domain
npm run typecheck --workspace @lovechapter/contracts
```

Expected: all focused tests and both typechecks PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/contracts/src/index.ts packages/domain/src/ports.ts packages/domain/src/service.ts packages/domain/src/service.test.ts packages/domain/src/testing/in-memory-repository.ts packages/domain/src/testing/in-memory-repository.test.ts
git commit -m "feat: define complete guest management contracts"
```

---

### Task 2: Guest and postal-address schema

**Files:**

- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/schema.test.ts`
- Create: generated `packages/database/drizzle/0004_*.sql`
- Create: generated `packages/database/drizzle/meta/0004_snapshot.json`
- Modify: `packages/database/drizzle/meta/_journal.json`

**Interfaces:**

- Consumes: Task 1 field limits and existing composite guest key `(wedding_id, id)`.
- Produces: nullable guest detail/archive columns and `guest_postal_addresses` with a same-wedding composite foreign key.

- [ ] **Step 1: Write failing schema tests**

Assert that `guests` exposes `phone`, `envelope_name`, `note`,
`archived_at`, and `updated_at`; assert address limits, the composite guest
foreign key, and both active/archived list indexes.

```ts
expect(columnNames(guests)).toEqual(
  expect.arrayContaining([
    "phone",
    "envelope_name",
    "note",
    "archived_at",
    "updated_at",
  ]),
);
expect(indexNames(guests)).toEqual(
  expect.arrayContaining([
    "guests_wedding_active_created_idx",
    "guests_wedding_archived_created_idx",
  ]),
);
expect(foreignKeyNames(guestPostalAddresses)).toContain(
  "guest_postal_addresses_guest_scope_fk",
);
```

- [ ] **Step 2: Run the schema test and confirm RED**

Run:

```bash
npm test -- packages/database/src/schema.test.ts
```

Expected: FAIL because the new columns/table/indexes are absent.

- [ ] **Step 3: Implement the schema**

Add nullable guest columns using the exact approved limits and retain the
existing `updated_at` supplied by the shared timestamp fields; do not add a
duplicate column. Add
`guestPostalAddresses` with:

```ts
export const guestPostalAddresses = pgTable(
  "guest_postal_addresses",
  {
    weddingId: uuid("wedding_id").notNull(),
    guestId: uuid("guest_id").notNull(),
    addressLine1: varchar("address_line_1", { length: 180 }).notNull(),
    addressLine2: varchar("address_line_2", { length: 180 }),
    locality: varchar("locality", { length: 120 }),
    administrativeArea: varchar("administrative_area", { length: 120 }),
    postalCode: varchar("postal_code", { length: 32 }),
    countryCode: varchar("country_code", { length: 2 }),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "guest_postal_addresses_pkey",
      columns: [table.weddingId, table.guestId],
    }),
    foreignKey({
      name: "guest_postal_addresses_guest_scope_fk",
      columns: [table.weddingId, table.guestId],
      foreignColumns: [guests.weddingId, guests.id],
    }).onDelete("cascade"),
    check(
      "guest_postal_addresses_country_code_check",
      sql.raw("country_code is null or country_code ~ '^[A-Z]{2}$'"),
    ),
  ],
);
```

Replace the unfiltered guest list index with two partial indexes ordered by
`wedding_id, created_at DESC, id DESC`, one for `archived_at IS NULL` and
one for `archived_at IS NOT NULL`. Retain the affiliation index because it
supports the filter.

- [ ] **Step 4: Generate and inspect the migration**

Run:

```bash
npm run db:generate --workspace @lovechapter/database
npm run db:check --workspace @lovechapter/database
```

Inspect the generated SQL for nullable additions without table-rewrite defaults,
same-wedding foreign keys, correct partial-index predicates, and no unintended
drop of affiliation constraints.

- [ ] **Step 5: Run schema and snapshot checks**

Run:

```bash
npm test -- packages/database/src/schema.test.ts
npm run db:check --workspace @lovechapter/database
git diff --check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/database/src/schema.ts packages/database/src/schema.test.ts packages/database/drizzle
git commit -m "feat: add guest details and optional postal addresses"
```

---

### Task 3: Tenant-scoped PostgreSQL guest operations

**Files:**

- Modify: `packages/database/src/queries.ts`
- Modify: `packages/database/src/query-contract.test.ts`
- Modify: `packages/database/src/repository.ts`
- Modify: `packages/database/src/repository.test.ts`
- Modify: `packages/database/src/guest-affiliations-postgres.integration.ts`

**Interfaces:**

- Consumes: Task 1 repository signatures and Task 2 schema.
- Produces: filtered list/detail queries, atomic update/archive/restore, and all-or-nothing bulk mutations.

- [ ] **Step 1: Write failing SQL contract tests**

Add contract cases for these exact query builders:

```ts
buildListGuestsQuery({
  userId,
  weddingId,
  limit: 20,
  view: "active",
  search: "สม",
  affiliation: "unassigned",
  rsvp: "pending",
});
buildGetGuestQuery({ userId, weddingId, guestId });
buildUpdateGuestQuery({ userId, weddingId, guestId, patch });
buildArchiveGuestQuery({ userId, weddingId, guestId });
buildRestoreGuestQuery({ userId, weddingId, guestId });
buildBulkSetGuestAffiliationQuery({
  userId,
  weddingId,
  guestIds,
  affiliationId,
});
buildBulkArchiveGuestsQuery({ userId, weddingId, guestIds });
```

Assert generated SQL contains membership scope, wedding predicates, archive
predicate, keyset predicate, bounded limit, RSVP `EXISTS`/join logic,
`unnest($n::uuid[])` for bulk IDs, and no `SELECT *`.

- [ ] **Step 2: Write failing repository tests**

Pin:

- list returns a stable page and does not include the detail-only note/address;
- detail maps a nullable address;
- PATCH performs guest and address changes in one transaction;
- omitted address produces no address statement;
- explicit null deletes the address;
- guest creation writes its optional address in the same transaction;
- archive updates the guest before revoking every active invitation;
- restore only clears `archived_at`;
- invitation creation and public-token resolution both reject archived guests;
- bulk methods compare the materialized input count with the affected count and
  throw `NotFoundError` without partial success.

- [ ] **Step 3: Run focused database tests and confirm RED**

Run:

```bash
npm test -- packages/database/src/query-contract.test.ts packages/database/src/repository.test.ts
```

Expected: FAIL because the builders and repository methods are absent.

- [ ] **Step 4: Implement filtered list and detail queries**

Change `buildListGuestsQuery` to accept the normalized repository filter and
push every filter into SQL. Search is a bounded, escaped case-insensitive prefix
match against name, email, or phone; escape `%`, `_`, and the escape
character before building `LIKE value || '%'`. Use a single RSVP left join,
the existing affiliation join, and `limit + 1`.

Create `buildGetGuestQuery` selecting detail fields plus one left-joined
postal-address row. Both queries begin from an authorized-wedding CTE so an
empty wedding and an empty guest list remain distinguishable.

- [ ] **Step 5: Implement update, archive, restore, and bulk builders**

Use one repository transaction for each multi-statement operation:

```ts
await executor.transaction(async (transaction) => {
  const guest = await transaction.execute(buildUpdateGuestQuery(input));
  if (!guest.rows[0]) throw new NotFoundError("Guest not found");
  if ("postalAddress" in input.patch) {
    await transaction.execute(
      input.patch.postalAddress
        ? buildUpsertGuestPostalAddressQuery(input)
        : buildDeleteGuestPostalAddressQuery(input),
    );
  }
  return loadGuestDetail(transaction, input);
});
```

Create-with-address inserts the guest first and upserts its optional address
inside one transaction. Archive locks and updates one active authorized guest, then revokes active
invitations for that exact `wedding_id, guest_id`. Bulk SQL materializes the
unique requested IDs once with `unnest`, authorizes the wedding, verifies the
complete guest set, and updates only when requested count equals matched count.
Bulk affiliation assignment also locks the chosen affiliation scope before the
set update so concurrent affiliation deletion cannot race it.

Add `archived_at IS NULL` to both invitation creation and public invitation
resolution. This is defense in depth in addition to archive-time revocation and
ensures an archived guest cannot receive or use a token during a concurrent
request.

- [ ] **Step 6: Add live PostgreSQL integration cases**

Extend the opt-in suite to verify:

- another wedding member cannot read/update/archive/restore a guest;
- archived invitation lookup returns no row;
- restore leaves `revoked_at` set;
- a 2-ID bulk request with one foreign ID affects zero rows;
- concurrent affiliation deletion versus bulk assignment resolves without a
  dangling foreign key;
- filtered cursor traversal over equal timestamps has no duplicates/skips.

Keep the existing `TEST_DATABASE_CONFIRM=lovechapter_test` destructive-test
guard.

- [ ] **Step 7: Run focused tests**

Run:

```bash
npm test -- packages/database/src/query-contract.test.ts packages/database/src/repository.test.ts
npm run typecheck --workspace @lovechapter/database
```

When a disposable database is available, additionally run:

```bash
TEST_DATABASE_CONFIRM=lovechapter_test npm run test:postgres --workspace @lovechapter/database
```

Expected provider-free checks: PASS. Record the live suite as not run when the
required URL is absent; never infer it from `DATABASE_URL`.

- [ ] **Step 8: Commit**

```bash
git add packages/database/src/queries.ts packages/database/src/query-contract.test.ts packages/database/src/repository.ts packages/database/src/repository.test.ts packages/database/src/guest-affiliations-postgres.integration.ts
git commit -m "feat: add transactional guest management queries"
```

---

### Task 4: Guest management API routes

**Files:**

- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `packages/domain/src/service.ts`
- Modify: `packages/domain/src/service.test.ts`

**Interfaces:**

- Consumes: Tasks 1 and 3 service/repository operations.
- Produces: filtered list, detail, PATCH, archive, restore, bulk-affiliation, and bulk-archive HTTP endpoints.

- [ ] **Step 1: Write failing API tests**

Cover the exact routes and statuses:

```text
GET   /v1/weddings/:weddingId/guests
GET   /v1/weddings/:weddingId/guests/:guestId
PATCH /v1/weddings/:weddingId/guests/:guestId
POST  /v1/weddings/:weddingId/guests/:guestId/archive
POST  /v1/weddings/:weddingId/guests/:guestId/restore
PATCH /v1/weddings/:weddingId/guests/bulk-affiliation
POST  /v1/weddings/:weddingId/guests/bulk-archive
```

Assert query validation rejects invalid view/RSVP/UUID/cursor/limit values,
PATCH rejects unknown properties, bulk arrays reject empty/duplicate/201-item
input, archive returns the archived detail, and cross-wedding operations become
404 without leaking existence.

- [ ] **Step 2: Run API tests and confirm RED**

Run:

```bash
npm test -- apps/api/src/app.test.ts
```

Expected: FAIL for absent routes and schemas.

- [ ] **Step 3: Add Elysia schemas and routes**

Extend the list query with:

```ts
const guestListQuery = t.Object({
  limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100, default: 20 })),
  cursor: t.Optional(t.String({ minLength: 1, maxLength: 500 })),
  search: t.Optional(t.String({ minLength: 1, maxLength: 120 })),
  affiliation: t.Optional(
    t.Union([t.Literal("unassigned"), t.String({ format: "uuid" })]),
  ),
  rsvp: t.Optional(
    t.Union([
      t.Literal("pending"),
      t.Literal("attending"),
      t.Literal("declined"),
    ]),
  ),
  view: t.Optional(
    t.Union([t.Literal("active"), t.Literal("archived")], {
      default: "active",
    }),
  ),
});
```

Define separate create and PATCH bodies so PATCH can distinguish omitted fields
from explicit null address. Register static bulk routes before
`/:guestId` routes to avoid route ambiguity. Preserve the global
JSON/origin/ingress security boundary.

- [ ] **Step 4: Run API and domain tests**

Run:

```bash
npm test -- apps/api/src/app.test.ts packages/domain/src/service.test.ts
npm run typecheck --workspace @lovechapter/api
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/app.ts apps/api/src/app.test.ts packages/domain/src/service.ts packages/domain/src/service.test.ts
git commit -m "feat: expose complete guest management API"
```

---

### Task 5: Couple-facing guest workspace

**Files:**

- Modify: `apps/web/lib/api-client.ts`
- Modify: `apps/web/lib/api-client.test.ts`
- Modify: `apps/web/components/couple-workspace.tsx`
- Modify: `apps/web/components/couple-workspace.test.tsx`
- Create: `apps/web/components/guest-management/guest-workspace.tsx`
- Create: `apps/web/components/guest-management/guest-workspace.test.tsx`
- Create: `apps/web/components/guest-management/guest-form.tsx`
- Create: `apps/web/components/guest-management/guest-list.tsx`
- Create: `apps/web/components/guest-management/guest-filters.tsx`
- Create: `apps/web/components/guest-management/guest-detail-dialog.tsx`

**Interfaces:**

- Consumes: Task 4 HTTP endpoints and existing stale-response generation/version guards.
- Produces: searchable/filterable/paginated guest UI with create/edit, archive/restore, row selection, and bounded bulk actions.

- [ ] **Step 1: Write failing API-client tests**

Assert exact query serialization and methods:

```ts
api.listGuests(weddingId, {
  limit: 20,
  view: "active",
  search: "สมชาย",
  affiliation: "unassigned",
  rsvp: "pending",
});
api.getGuest(weddingId, guestId);
api.updateGuest(weddingId, guestId, patch);
api.archiveGuest(weddingId, guestId);
api.restoreGuest(weddingId, guestId);
api.bulkSetGuestAffiliation(weddingId, input);
api.bulkArchiveGuests(weddingId, { guestIds });
```

Check `URLSearchParams` encoding rather than interpolating raw search text.

- [ ] **Step 2: Write failing component tests**

Use Testing Library and fake timers to pin:

- 300 ms debounced search;
- active/archived, affiliation/unassigned, and RSVP filters reset the cursor;
- loading more appends without duplicating IDs;
- stale pre-filter and pre-mutation responses cannot overwrite newer state;
- edit loads detail on demand and leaves address fields optional/collapsed;
- archive requires confirmation, removes the row from active view, and restore
  removes it from archived view;
- selection never exceeds 200 and resets when wedding/view/filter changes;
- bulk assignment includes null/unassigned and refreshes the current page;
- a failed bulk action leaves selected rows visible and selected.

- [ ] **Step 3: Run focused web tests and confirm RED**

Run:

```bash
npm test -- apps/web/lib/api-client.test.ts apps/web/components/couple-workspace.test.tsx apps/web/components/guest-management/guest-workspace.test.tsx
```

Expected: FAIL because the client methods and components are absent.

- [ ] **Step 4: Implement API-client methods**

Add a `guestListQuery(input)` helper using `URLSearchParams`, then add all
Task 4 methods. Keep authentication handling centralized in
`authenticatedRequest`.

- [ ] **Step 5: Split and implement the guest workspace**

Keep wedding selection and cross-wedding request generation in
`couple-workspace.tsx`. Move guest-specific state and rendering to
`GuestWorkspace`; pass the selected wedding ID, affiliations, and API
facade. Use:

```ts
type GuestSelection = ReadonlySet<string>;
type GuestFilters = {
  search: string;
  affiliation?: string | "unassigned";
  rsvp?: GuestRsvpFilter;
  view: GuestView;
};
```

Store list request IDs and a mutation version inside the guest workspace.
Every successful mutation increments the version before replacing or
refreshing rows. Use semantic buttons, associated labels, keyboard-accessible
selection checkboxes, `aria-live` result totals, and clear empty/error states.

The primary form shows name/email/party allowance/affiliation. A disclosure
labeled “Optional contact, envelope, and mailing details” contains phone,
envelope name, note, and postal address. Address line 1 is required only while
that optional address block is enabled.

- [ ] **Step 6: Run focused web checks**

Run:

```bash
npm test -- apps/web/lib/api-client.test.ts apps/web/components/couple-workspace.test.tsx apps/web/components/guest-management/guest-workspace.test.tsx
npm run typecheck --workspace @lovechapter/web
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/api-client.ts apps/web/lib/api-client.test.ts apps/web/components/couple-workspace.tsx apps/web/components/couple-workspace.test.tsx apps/web/components/guest-management
git commit -m "feat: build complete guest management workspace"
```

---

### Task 6: Guest-management slice release gate

**Files:**

- Modify: `docs/PROGRESS.md`
- Modify: `PROJECT_CONTEXT.md`

**Interfaces:**

- Consumes: Tasks 1–5.
- Produces: verified first delivery slice and accurate documentation for the CSV plans.

- [ ] **Step 1: Run focused and repository-wide verification**

Run:

```bash
npm test -- packages/domain/src/service.test.ts packages/database/src/query-contract.test.ts packages/database/src/repository.test.ts apps/api/src/app.test.ts apps/web/lib/api-client.test.ts apps/web/components/guest-management/guest-workspace.test.tsx
npm run ci
git diff --check
```

Expected: all provider-free checks PASS.

- [ ] **Step 2: Review generated SQL and indexes**

Confirm list/detail SQL is tenant-scoped, list SQL is bounded and deterministic,
bulk SQL is set-based, archive revocation is transactional, and the two partial
guest indexes match active/archived cursor access. When disposable PostgreSQL is
available, capture `EXPLAIN (ANALYZE, BUFFERS)` for active list, affiliation
filter, archived list, and prefix search using representative data.

- [ ] **Step 3: Update project documentation**

Record the completed guest-management behavior and the exact checks actually
run. Keep the live PostgreSQL suite/query plans listed as staging gates when no
confirmed disposable database is supplied.

- [ ] **Step 4: Commit**

```bash
git add PROJECT_CONTEXT.md docs/PROGRESS.md
git commit -m "docs: record guest management verification"
```
