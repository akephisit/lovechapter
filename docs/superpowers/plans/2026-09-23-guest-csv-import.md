# Guest CSV Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable two-step CSV import that maps and previews up to 5,000 creation-only guest rows, surfaces errors and duplicate warnings, and commits an approved set exactly once.

**Architecture:** The API uses the maintained `csv-parse` stream parser at the upload boundary, immediately discards raw bytes, and passes bounded row arrays to pure domain mapping/validation. PostgreSQL stores a 24-hour batch plus normalized staging rows. Mapping updates rebuild validation and duplicate warnings set-wise; commit locks the batch, verifies its preview version and explicit duplicate decisions, inserts guests/addresses in bounded set-based chunks, and stores the idempotent result.

**Tech Stack:** TypeScript 6.0.3, csv-parse 7.0.2, Elysia 2.0.0-beta.16, Drizzle ORM 0.45.3, PostgreSQL, Bun 1.4.2, React 19.3.0, Vitest 5.0.1

**Spec:** `docs/superpowers/specs/2026-09-23-guest-management-csv-envelope-design.md`

## Global Constraints

- Upload content type is `text/csv`; compressed, binary, non-UTF-8, and non-comma input is rejected rather than guessed.
- Existing 1 MiB proxy and Bun body limits remain unchanged.
- A file has at most 5,000 non-header rows, 40 columns, and 4,096 Unicode characters per cell; blank physical rows are ignored.
- A maintained streaming parser handles BOM, RFC 4180 quotes, CRLF, and LF.
- `name` is the only required mapping; import creates guests only and never silently updates or merges.
- Raw CSV bytes are discarded after parsing and never logged or persisted.
- Staged normalized rows expire after 24 hours and cleanup is bounded/deterministic.
- Unknown affiliations are errors until explicitly mapped to a wedding affiliation or their rows are excluded; no affiliation is invented.
- Duplicate matches are warnings; included warning rows require explicit “create anyway” decisions.
- Commit is all-or-nothing, accepts at most 5,000 included rows, checks the exact preview version, and is idempotent per batch/key.
- Every batch/row/commit query includes authenticated wedding membership scope.

## Review Focus

- Invalid UTF-8, NUL bytes, malformed quotes, duplicate/blank headers, 41 columns, 5,001 rows, and 4,097-character cells fail with sanitized errors; Tasks 1 and 5 pin the boundary.
- Repeated email and normalized name+phone duplicates inside the file, plus likely active-wedding matches, appear as warnings without automatic merging; Tasks 2 and 4 pin this.
- A mapping update racing commit cannot commit a stale preview version; Task 6 pins the lock/version behavior in live PostgreSQL coverage.
- Retrying a completed batch with the same idempotency key returns the original IDs, while another key conflicts; Task 6 pins both outcomes.
- Dangerous formula prefixes remain inert in preview/storage/export and user values render only as text nodes; Tasks 1, 2, and 7 pin this.

---

### Task 1: Bounded streaming CSV parser

**Files:**

- Modify: `apps/api/package.json`
- Modify: `package-lock.json`
- Create: `apps/api/src/guest-csv-parser.ts`
- Create: `apps/api/src/guest-csv-parser.test.ts`

**Interfaces:**

- Consumes: a bounded raw `Uint8Array` from the request body.
- Produces: `ParsedGuestCsv = { sourceSha256: string; headers: string[]; rows: string[][] }`.

- [ ] **Step 1: Install the pinned maintained parser**

Run:

```bash
npm install csv-parse@7.0.2 --workspace @lovechapter/api
```

The parser's official stream API and ESM import are documented at
`https://csv.js.org/parse/api/stream/` and
`https://csv.js.org/parse/distributions/nodejs_esm/`.

- [ ] **Step 2: Write failing parser boundary tests**

Cover UTF-8 with/without BOM, Thai text, CRLF/LF, commas/newlines/quotes inside
quoted fields, ignored blank rows, SHA-256 stability, malformed quotes, semicolon
input, invalid UTF-8, NUL, empty input/header, blank or duplicate normalized
headers, 41 columns, 5,001 data rows, ragged rows, and a 4,097-character cell.
Assert errors expose only a code and row number, never the raw row.

- [ ] **Step 3: Run the parser test and confirm RED**

Run:

```bash
npm test -- apps/api/src/guest-csv-parser.test.ts
```

Expected: FAIL because the parser module does not exist.

- [ ] **Step 4: Implement the parser**

Export:

```ts
export const MAX_GUEST_CSV_ROWS = 5_000;
export const MAX_GUEST_CSV_COLUMNS = 40;
export const MAX_GUEST_CSV_CELL_CHARACTERS = 4_096;

export type ParsedGuestCsv = {
  sourceSha256: string;
  headers: string[];
  rows: string[][];
};

export async function parseGuestCsv(bytes: Uint8Array): Promise<ParsedGuestCsv>;
```

First reject NUL and decode with `new TextDecoder("utf-8", { fatal: true })`.
Compute SHA-256 from the original bytes. Pipe the decoded text through
`csv-parse` with `bom: true`, comma delimiter, strict column count,
`skip_empty_lines: true`, and bounded record size. Iterate records with
`for await`, enforce row/column/cell limits immediately, and normalize headers
only for duplicate detection; preserve the displayed header text. If the
single parsed header contains a semicolon or tab delimiter candidate, return
`unsupported_delimiter` instead of presenting it as an unmapped one-column
file.

- [ ] **Step 5: Run focused checks and commit**

Run:

```bash
npm test -- apps/api/src/guest-csv-parser.test.ts
npm run typecheck --workspace @lovechapter/api
```

Then commit:

```bash
git add apps/api/package.json package-lock.json apps/api/src/guest-csv-parser.ts apps/api/src/guest-csv-parser.test.ts
git commit -m "feat: add bounded guest CSV parser"
```

---

### Task 2: Import mapping and validation domain

**Files:**

- Modify: `packages/contracts/src/index.ts`
- Create: `packages/domain/src/guest-import.ts`
- Create: `packages/domain/src/guest-import.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/src/ports.ts`

**Interfaces:**

- Consumes: headers/rows from Task 1 and wedding affiliations.
- Produces: versioned mapping, normalized candidates, row messages, preview types, and commit input.

- [ ] **Step 1: Define exact import contracts**

```ts
export const GUEST_IMPORT_FIELDS = [
  "name",
  "email",
  "phone",
  "allowedPartySize",
  "affiliation",
  "envelopeName",
  "addressLine1",
  "addressLine2",
  "locality",
  "administrativeArea",
  "postalCode",
  "countryCode",
  "note",
] as const;
export type GuestImportField = (typeof GUEST_IMPORT_FIELDS)[number];
export type GuestImportMapping = Record<GuestImportField, number | null>;

export type GuestImportMappingInput = {
  expectedVersion: number;
  mapping: GuestImportMapping;
  affiliationMappings: Record<string, string>;
  excludedRowIds: string[];
};

export type GuestImportCommitInput = {
  expectedVersion: number;
  includedRowIds: string[];
  createAnywayRowIds: string[];
  idempotencyKey: string;
};

export type GuestImportPreviewRow = {
  id: string;
  rowNumber: number;
  candidate: CreateGuestInput | null;
  errors: string[];
  warnings: string[];
  included: boolean;
};

export type GuestImportTotals = {
  valid: number;
  warning: number;
  invalid: number;
  excluded: number;
};

export type GuestImportPreview = {
  batchId: string;
  headers: string[];
  mapping: GuestImportMapping;
  affiliationMappings: Record<string, string>;
  mappingVersion: number;
  status: "previewed" | "committed";
  totals: GuestImportTotals;
  items: GuestImportPreviewRow[];
  nextCursor: string | null;
};

export type GuestImportCommitResult = {
  created: number;
  excluded: number;
  guestIds: string[];
};
```

- [ ] **Step 2: Write failing pure-domain tests**

Pin auto-mapping of the documented English headers, required unique name
mapping, duplicate destination-column rejection, field normalization/limits,
party-size default 1, optional address construction only when line 1 exists,
case-insensitive affiliation resolution, unknown-affiliation error, duplicate
email and name+phone warnings, and formula-prefix neutralization.

```ts
expect(safeImportedText("  =2+2")).toBe("'  =2+2");
expect(
  autoMapGuestHeaders(["name", "email", "allowed_party_size"]),
).toMatchObject({ name: 0, email: 1, allowedPartySize: 2 });
```

- [ ] **Step 3: Run tests and confirm RED**

Run:

```bash
npm test -- packages/domain/src/guest-import.test.ts
```

Expected: FAIL because mapping/validation does not exist.

- [ ] **Step 4: Implement pure functions**

Export:

```ts
export function normalizeGuestImportHeader(value: string): string;
export function autoMapGuestHeaders(headers: string[]): GuestImportMapping;
export function validateGuestImportMapping(
  headers: string[],
  mapping: GuestImportMapping,
): void;
export function buildGuestImportCandidates(input: {
  rows: Array<{
    id: string;
    rowNumber: number;
    values: string[];
    included: boolean;
  }>;
  mapping: GuestImportMapping;
  affiliations: GuestAffiliation[];
  affiliationMappings: Record<string, string>;
}): GuestImportPreviewRow[];
export function addWithinFileDuplicateWarnings(
  rows: GuestImportPreviewRow[],
): GuestImportPreviewRow[];
```

Reuse Guest Management normalization rules rather than defining different
limits. `safeImportedText` prepends an apostrophe to text beginning with a
dangerous spreadsheet prefix after spaces/tabs. Never evaluate formulas or
render them as HTML.

- [ ] **Step 5: Run focused checks and commit**

Run:

```bash
npm test -- packages/domain/src/guest-import.test.ts
npm run typecheck --workspace @lovechapter/contracts
npm run typecheck --workspace @lovechapter/domain
```

Then commit:

```bash
git add packages/contracts/src/index.ts packages/domain/src/guest-import.ts packages/domain/src/guest-import.test.ts packages/domain/src/index.ts packages/domain/src/ports.ts
git commit -m "feat: define guest import mapping and validation"
```

---

### Task 3: Durable import staging schema

**Files:**

- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/schema.test.ts`
- Create: generated `packages/database/drizzle/0005_*.sql`
- Create: generated `packages/database/drizzle/meta/0005_snapshot.json`
- Modify: `packages/database/drizzle/meta/_journal.json`

**Interfaces:**

- Consumes: Task 2 contracts and existing users/weddings keys.
- Produces: `guest_import_batches` and `guest_import_rows`.

- [ ] **Step 1: Write failing schema tests**

Assert:

- batch composite key `(wedding_id, id)`;
- creator/wedding foreign keys;
- source SHA-256 length 64;
- JSONB headers/mapping/affiliation mapping/result;
- status enum `previewed | committed`;
- positive preview version and bounded counts;
- row composite key and same-wedding batch foreign key;
- unique `(wedding_id, batch_id, row_number)`;
- cleanup index `status, expires_at, wedding_id, id`;
- preview index `wedding_id, batch_id, row_number, id`.

- [ ] **Step 2: Run schema test and confirm RED**

Run:

```bash
npm test -- packages/database/src/schema.test.ts
```

Expected: FAIL because staging tables are absent.

- [ ] **Step 3: Implement staging tables**

`guest_import_batches` stores creator, SHA-256, headers, mapping,
affiliation mappings, status, preview version, counts, optional commit key/result,
`created_at`, `updated_at`, `expires_at`, and `committed_at`.
`guest_import_rows` stores UUID ID, wedding/batch IDs, one-based CSV row
number, `source_values` JSONB, nullable candidate JSONB, errors/warnings JSONB,
and included boolean. Raw bytes are never a column.

- [ ] **Step 4: Generate and inspect the migration**

Run:

```bash
npm run db:generate --workspace @lovechapter/database
npm run db:check --workspace @lovechapter/database
```

Inspect JSONB defaults/checks, cascading row cleanup, index column order, and
absence of unbounded or global uniqueness that would leak tenants.

- [ ] **Step 5: Run checks and commit**

Run:

```bash
npm test -- packages/database/src/schema.test.ts
npm run db:check --workspace @lovechapter/database
git diff --check
```

Then commit:

```bash
git add packages/database/src/schema.ts packages/database/src/schema.test.ts packages/database/drizzle
git commit -m "feat: add durable guest import staging"
```

---

### Task 4: Import staging repository and duplicate lookup

**Files:**

- Create: `packages/database/src/guest-import-queries.ts`
- Create: `packages/database/src/guest-import-query-contract.test.ts`
- Create: `packages/database/src/guest-import-repository.ts`
- Create: `packages/database/src/guest-import-repository.test.ts`
- Modify: `packages/database/src/client.ts`
- Modify: `packages/database/src/index.ts`
- Modify: `packages/domain/src/ports.ts`

**Interfaces:**

- Consumes: Tasks 2–3 types/tables.
- Produces: `GuestImportRepository` for stage, load, preview page, mapping replacement, existing-guest duplicate lookup, and commit in Task 6.

- [ ] **Step 1: Define the repository port**

```ts
export interface GuestImportRepository {
  stageGuestImport(input: StageGuestImportInput): Promise<GuestImportPreview>;
  getGuestImport(
    userId: string,
    weddingId: string,
    batchId: string,
    page: RepositoryPageInput,
  ): Promise<GuestImportPreview>;
  loadGuestImportForMapping(
    userId: string,
    weddingId: string,
    batchId: string,
  ): Promise<GuestImportMappingState>;
  findLikelyGuestDuplicates(
    userId: string,
    weddingId: string,
    candidates: GuestImportCandidateKey[],
  ): Promise<GuestImportDuplicateMatch[]>;
  replaceGuestImportPreview(
    input: ReplaceGuestImportPreviewInput,
  ): Promise<GuestImportPreview>;
}
```

Define its supporting port payloads in the same file:

```ts
export type GuestImportSourceRow = {
  id: string;
  rowNumber: number;
  values: string[];
  included: boolean;
};

export type StageGuestImportInput = {
  id: string;
  userId: string;
  weddingId: string;
  sourceSha256: string;
  headers: string[];
  mapping: GuestImportMapping;
  affiliationMappings: Record<string, string>;
  rows: Array<
    GuestImportSourceRow & {
      candidate: CreateGuestInput | null;
      errors: string[];
      warnings: string[];
    }
  >;
  expiresAt: string;
};

export type GuestImportMappingState = {
  batchId: string;
  headers: string[];
  mapping: GuestImportMapping;
  affiliationMappings: Record<string, string>;
  mappingVersion: number;
  status: "previewed" | "committed";
  rows: GuestImportSourceRow[];
};

export type GuestImportCandidateKey = {
  rowId: string;
  normalizedEmail: string | null;
  normalizedName: string;
  normalizedPhone: string | null;
};

export type GuestImportDuplicateMatch = {
  rowId: string;
  kind: "email" | "name_phone";
};

export type ReplaceGuestImportPreviewInput = {
  userId: string;
  weddingId: string;
  batchId: string;
  expectedVersion: number;
  mapping: GuestImportMapping;
  affiliationMappings: Record<string, string>;
  rows: Array<
    GuestImportSourceRow & {
      candidate: CreateGuestInput | null;
      errors: string[];
      warnings: string[];
    }
  >;
};
```

- [ ] **Step 2: Write failing query/repository tests**

Pin membership in every query, one set-based staging insert through
`jsonb_to_recordset`, bounded preview pagination, stable row-number/ID cursor,
authorized mapping load capped at 5,000, case-normalized active-guest duplicate
matching in one query, optimistic `preview_version` update, and no raw values
in thrown errors.

- [ ] **Step 3: Run tests and confirm RED**

Run:

```bash
npm test -- packages/database/src/guest-import-query-contract.test.ts packages/database/src/guest-import-repository.test.ts
```

Expected: FAIL because repository modules are absent.

- [ ] **Step 4: Implement set-based stage and preview queries**

Stage batch plus rows in one transaction. Serialize the bounded row objects once
and use parameterized `jsonb_to_recordset`; never concatenate CSV values into
SQL. Return the first 100 rows plus totals. Preview queries select only candidate,
message, inclusion, row number, and cursor fields.

- [ ] **Step 5: Implement duplicate lookup and preview replacement**

Pass candidate keys as parameterized JSONB and join them against active guests
within the authorized wedding. Match normalized email and normalized
name+phone, returning only staged row IDs and match kinds. Preview replacement
locks the batch, requires status `previewed` and exact expected version,
updates all rows set-wise from JSONB, increments version, and recomputes totals
in the same transaction.

- [ ] **Step 6: Wire the repository into the runtime**

Create one `PostgresGuestImportRepository` from the same process-wide
`QueryExecutor`; expose it as `guestImportRepository` on
`PostgresRuntime`. Do not create another pool.

- [ ] **Step 7: Run focused checks and commit**

Run:

```bash
npm test -- packages/database/src/guest-import-query-contract.test.ts packages/database/src/guest-import-repository.test.ts
npm run typecheck --workspace @lovechapter/database
```

Then commit:

```bash
git add packages/domain/src/ports.ts packages/database/src/guest-import-queries.ts packages/database/src/guest-import-query-contract.test.ts packages/database/src/guest-import-repository.ts packages/database/src/guest-import-repository.test.ts packages/database/src/client.ts packages/database/src/index.ts
git commit -m "feat: stage and preview guest imports"
```

---

### Task 5: Upload, mapping, and paginated preview API

**Files:**

- Modify: `packages/domain/src/service.ts`
- Modify: `packages/domain/src/service.test.ts`
- Modify: `apps/api/src/request-security.ts`
- Modify: `apps/api/src/request-security.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/api/src/server.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**

- Consumes: parser, domain mapping, affiliation list, and staging repository.
- Produces: upload, preview GET, and mapping PATCH routes.

- [ ] **Step 1: Write failing service/security/API tests**

Cover:

```text
POST  /v1/weddings/:weddingId/guest-imports                  text/csv
GET   /v1/weddings/:weddingId/guest-imports/:batchId
PATCH /v1/weddings/:weddingId/guest-imports/:batchId/mapping application/json
```

Assert only the exact upload path accepts `text/csv`; commit/mapping still
require JSON. Assert 1 MiB remains enforced, upload returns 201, preview is
bounded, stale mapping version returns 409, unknown affiliations are errors,
explicit existing-affiliation mapping clears them, exclusion updates totals,
and cross-wedding batches return 404.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
npm test -- packages/domain/src/service.test.ts apps/api/src/request-security.test.ts apps/api/src/app.test.ts apps/api/src/server.test.ts
```

Expected: FAIL for absent service/routes and CSV content-type exception.

- [ ] **Step 3: Implement service orchestration**

`stageGuestImport` auto-maps headers, loads wedding affiliations, builds
candidates/warnings, calls one existing-guest duplicate lookup, merges warnings,
and stages with `expiresAt = now + 24 hours`. `updateGuestImportMapping`
loads the authorized batch/rows, validates exact version and row IDs, rebuilds
all candidates, adds duplicate warnings, and atomically replaces the preview.
`getGuestImport` returns one bounded page.

Extend `LoveChapterService` with an injected `GuestImportRepository` and
wire `postgres.guestImportRepository` in `apps/api/src/server.ts`; keep the
existing `LoveChapterRepository` focused on weddings, guests, invitations, and
RSVP.

- [ ] **Step 4: Implement the content-type boundary and routes**

Add an exact method/path helper:

```ts
export function isGuestCsvUpload(request: Request): boolean {
  return (
    request.method === "POST" &&
    /^\/v1\/weddings\/[0-9a-f-]{36}\/guest-imports$/iu.test(
      new URL(request.url).pathname,
    )
  );
}
```

Mutation origin remains mandatory. Exact upload requires `text/csv`; all
other mutations require `application/json`. The upload handler reads at most
the already-enforced body cap, calls `parseGuestCsv`, and never logs bytes or
row content.

- [ ] **Step 5: Run focused checks and commit**

Run:

```bash
npm test -- packages/domain/src/service.test.ts apps/api/src/request-security.test.ts apps/api/src/app.test.ts apps/api/src/server.test.ts
npm run typecheck --workspace @lovechapter/api
```

Then commit:

```bash
git add packages/domain/src/service.ts packages/domain/src/service.test.ts apps/api/src/request-security.ts apps/api/src/request-security.test.ts apps/api/src/app.ts apps/api/src/app.test.ts apps/api/src/server.ts apps/api/src/server.test.ts
git commit -m "feat: expose guest import preview workflow"
```

---

### Task 6: Atomic idempotent import commit

**Files:**

- Modify: `packages/domain/src/ports.ts`
- Modify: `packages/domain/src/service.ts`
- Modify: `packages/domain/src/service.test.ts`
- Modify: `packages/database/src/guest-import-queries.ts`
- Modify: `packages/database/src/guest-import-query-contract.test.ts`
- Modify: `packages/database/src/guest-import-repository.ts`
- Modify: `packages/database/src/guest-import-repository.test.ts`
- Create: `packages/database/src/guest-import-postgres.integration.ts`
- Modify: `packages/database/vitest.postgres.config.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`

**Interfaces:**

- Consumes: a previewed batch and `GuestImportCommitInput`.
- Produces: exactly-once `GuestImportCommitResult` and committed guests/addresses.

Extend the repository port with:

```ts
commitGuestImport(input: {
  userId: string;
  weddingId: string;
  batchId: string;
  expectedVersion: number;
  includedRowIds: string[];
  createAnywayRowIds: string[];
  idempotencyKey: string;
}): Promise<GuestImportCommitResult>;
```

- [ ] **Step 1: Write failing service/repository/API tests**

Pin UUID/idempotency-key validation, exact mapping version, complete included-row
set, no invalid rows, explicit decisions for every included warning row,
exclusion count, same-key replay, different-key conflict, and no invitation
creation. API route:

```text
POST /v1/weddings/:weddingId/guest-imports/:batchId/commit
```

- [ ] **Step 2: Write failing live PostgreSQL tests**

Create a disposable batch and prove:

- cross-wedding commit creates zero guests;
- one invalid included row rolls back every guest/address;
- 2,001 valid rows insert in 1,000/1,000/1 set-based chunks inside one
  transaction;
- concurrent mapping update versus commit allows only one preview version;
- two concurrent same-key commits return one identical stored result;
- a later different-key retry conflicts and adds no rows.

- [ ] **Step 3: Run provider-free tests and confirm RED**

Run:

```bash
npm test -- packages/domain/src/service.test.ts packages/database/src/guest-import-query-contract.test.ts packages/database/src/guest-import-repository.test.ts apps/api/src/app.test.ts
```

Expected: FAIL because commit is absent.

- [ ] **Step 4: Implement the commit transaction**

Repository algorithm:

1. lock the authorized batch `FOR UPDATE`;
2. if committed, return stored result only when key matches;
3. require status `previewed` and exact preview version;
4. load the requested staged rows and verify complete membership, inclusion,
   zero errors, and explicit decisions for every warning;
5. allocate guest UUIDs;
6. insert guests in parameterized JSONB chunks of at most 1,000;
7. insert present addresses for the same chunk;
8. store `commit_idempotency_key`, JSON result, and committed status/time
   while retaining the original 24-hour expiry so retry metadata has the same
   documented lifetime as the batch;
9. commit once.

Do not call external systems or create invitation links inside the transaction.

- [ ] **Step 5: Add service and API method**

Normalize unique row-ID arrays capped at 5,000 and an idempotency key of 1–128
visible ASCII characters. Return created IDs and counts only.

- [ ] **Step 6: Run focused checks**

Run:

```bash
npm test -- packages/domain/src/service.test.ts packages/database/src/guest-import-query-contract.test.ts packages/database/src/guest-import-repository.test.ts apps/api/src/app.test.ts
npm run typecheck --workspace @lovechapter/database
npm run typecheck --workspace @lovechapter/api
```

When disposable PostgreSQL is supplied:

```bash
TEST_DATABASE_CONFIRM=lovechapter_test npm run test:postgres --workspace @lovechapter/database
```

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/ports.ts packages/domain/src/service.ts packages/domain/src/service.test.ts packages/database/src/guest-import-queries.ts packages/database/src/guest-import-query-contract.test.ts packages/database/src/guest-import-repository.ts packages/database/src/guest-import-repository.test.ts packages/database/src/guest-import-postgres.integration.ts packages/database/vitest.postgres.config.ts apps/api/src/app.ts apps/api/src/app.test.ts
git commit -m "feat: commit guest imports atomically"
```

---

### Task 7: CSV import wizard

**Files:**

- Modify: `apps/web/lib/api-client.ts`
- Modify: `apps/web/lib/api-client.test.ts`
- Create: `apps/web/components/guest-import/guest-import-workspace.tsx`
- Create: `apps/web/components/guest-import/guest-import-workspace.test.tsx`
- Create: `apps/web/components/guest-import/column-mapping.tsx`
- Create: `apps/web/components/guest-import/import-preview-table.tsx`
- Modify: `apps/web/components/guest-management/guest-workspace.tsx`
- Modify: `apps/web/components/guest-management/guest-workspace.test.tsx`

**Interfaces:**

- Consumes: Tasks 5–6 HTTP endpoints and existing affiliation creation API.
- Produces: upload → mapping → preview/exclusion → explicit duplicate decision → commit workflow.

- [ ] **Step 1: Write failing API-client tests**

Assert upload sends the raw `File` body with `text/csv` and no JSON
serialization. Assert preview query pagination, mapping PATCH, and commit POST
payloads preserve version/row IDs/idempotency key.

- [ ] **Step 2: Write failing wizard tests**

Cover client size/type checks, upload progress state, required name mapping,
unique column mapping, totals, paginated preview, invalid-row disablement,
exclude/include, duplicate “Create anyway” confirmation, unknown-affiliation
mapping, explicit creation through the existing affiliation endpoint, stale
version recovery, same-key retry after a network failure, success counts, and
guest-list refresh. Assert candidate values are rendered as React text, never
`dangerouslySetInnerHTML`.

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

```bash
npm test -- apps/web/lib/api-client.test.ts apps/web/components/guest-import/guest-import-workspace.test.tsx apps/web/components/guest-management/guest-workspace.test.tsx
```

Expected: FAIL because client methods and wizard are absent.

- [ ] **Step 4: Implement the client methods**

Add `uploadGuestCsv`, `getGuestImportPreview`,
`updateGuestImportMapping`, and `commitGuestImport`. Route upload through a
raw-response request helper that still applies same-origin credentials and
401 handling.

- [ ] **Step 5: Implement the wizard**

Use four explicit steps: Select CSV, Map columns, Review rows, Import. Keep the
generated `crypto.randomUUID()` idempotency key stable across commit retries
and replace it only after success or a deliberate new import. Never put row
content in console/error telemetry. Explain that imports create new guests only
and addresses remain optional.

- [ ] **Step 6: Run focused checks and commit**

Run:

```bash
npm test -- apps/web/lib/api-client.test.ts apps/web/components/guest-import/guest-import-workspace.test.tsx apps/web/components/guest-management/guest-workspace.test.tsx
npm run typecheck --workspace @lovechapter/web
```

Then commit:

```bash
git add apps/web/lib/api-client.ts apps/web/lib/api-client.test.ts apps/web/components/guest-import apps/web/components/guest-management/guest-workspace.tsx apps/web/components/guest-management/guest-workspace.test.tsx
git commit -m "feat: add guest CSV import wizard"
```

---

### Task 8: Bounded staging cleanup job

**Files:**

- Modify: `packages/database/src/guest-import-queries.ts`
- Modify: `packages/database/src/guest-import-query-contract.test.ts`
- Modify: `packages/database/src/guest-import-repository.ts`
- Modify: `packages/database/src/client.ts`
- Modify: `apps/jobs/src/processor.ts`
- Modify: `apps/jobs/src/processor.test.ts`
- Modify: `apps/jobs/src/index.ts`

**Interfaces:**

- Consumes: expired previewed or committed import batches.
- Produces: `cleanupExpiredGuestImports({ now, limit: 500 }): Promise<number>`.

Extend the repository/cleanup port with:

```ts
cleanupExpiredGuestImports(input: {
  now: string;
  limit: 500;
}): Promise<number>;
```

- [ ] **Step 1: Write failing cleanup tests**

Assert the SQL selects at most 500 expired batches of either status ordered by
`expires_at, wedding_id, id`, deletes only those IDs, relies on cascade for
rows, and therefore removes staged personal data and committed idempotency
metadata after the documented 24-hour lifetime. Job tests assert cleanup runs
on the existing 15-minute maintenance cadence, abort prevents a new cleanup,
and logs only the removed count.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
npm test -- packages/database/src/guest-import-query-contract.test.ts apps/jobs/src/processor.test.ts
```

Expected: FAIL because cleanup is absent.

- [ ] **Step 3: Implement and wire cleanup**

Expose the same `PostgresGuestImportRepository` instance as a cleanup store on
`PostgresRuntime`. Pass it into `runJobLoop`; run cleanup sequentially with
the existing auth cleanup so the job pool maximum remains 2 and maintenance
cannot fan out.

- [ ] **Step 4: Run focused checks and commit**

Run:

```bash
npm test -- packages/database/src/guest-import-query-contract.test.ts apps/jobs/src/processor.test.ts
npm run typecheck --workspace @lovechapter/database
npm run typecheck --workspace @lovechapter/jobs
```

Then commit:

```bash
git add packages/database/src/guest-import-queries.ts packages/database/src/guest-import-query-contract.test.ts packages/database/src/guest-import-repository.ts packages/database/src/client.ts apps/jobs/src/processor.ts apps/jobs/src/processor.test.ts apps/jobs/src/index.ts
git commit -m "feat: clean up expired guest imports"
```

---

### Task 9: CSV import release gate

**Files:**

- Modify: `PROJECT_CONTEXT.md`
- Modify: `docs/PROGRESS.md`
- Modify: `docs/DECISIONS.md`

**Interfaces:**

- Consumes: Tasks 1–8.
- Produces: verified import slice and documented parser/staging/idempotency decisions.

- [ ] **Step 1: Run complete import regression**

Run:

```bash
npm test -- apps/api/src/guest-csv-parser.test.ts packages/domain/src/guest-import.test.ts packages/database/src/guest-import-query-contract.test.ts packages/database/src/guest-import-repository.test.ts packages/domain/src/service.test.ts apps/api/src/request-security.test.ts apps/api/src/app.test.ts apps/web/lib/api-client.test.ts apps/web/components/guest-import/guest-import-workspace.test.tsx apps/jobs/src/processor.test.ts
npm run ci
git diff --check
```

Expected: every provider-free check PASS.

- [ ] **Step 2: Audit privacy and SQL**

Search active source for raw CSV/row logging, `dangerouslySetInnerHTML`,
per-row write loops, and unbounded staging queries. Inspect generated SQL and
the migration. When disposable PostgreSQL exists, run the concurrency suite and
representative preview/duplicate/commit/cleanup query plans.

- [ ] **Step 3: Update documentation**

Record `csv-parse@7.0.2`, the 1 MiB/5,000/40/4,096 bounds, 24-hour staging,
creation-only semantics, formula neutralization, idempotency, and exact
verification evidence. Keep missing live/manual gates explicit.

- [ ] **Step 4: Commit**

```bash
git add PROJECT_CONTEXT.md docs/PROGRESS.md docs/DECISIONS.md
git commit -m "docs: record durable guest CSV imports"
```
