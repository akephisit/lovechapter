# Guest CSV Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export the current authorized guest filter as spreadsheet-compatible, formula-safe UTF-8 CSV without buffering the whole wedding or exposing invitation credentials.

**Architecture:** A pure domain encoder owns the versioned header, RFC 4180 escaping, and formula neutralization. The repository supplies bounded keyset pages using the same filters as Guest Management. The service exposes a pull-driven Web `ReadableStream`; Elysia returns it as a download and the frontend saves the response without parsing it as JSON.

**Tech Stack:** TypeScript 6.0.3, Web Streams, Elysia 2.0.0-beta.16, Drizzle ORM 0.45.3, PostgreSQL, React 19.3.0, Vitest 5.0.1

**Spec:** `docs/superpowers/specs/2026-09-23-guest-management-csv-envelope-design.md`

## Global Constraints

- The header is exactly `name,email,phone,allowed_party_size,affiliation,envelope_name,address_line_1,address_line_2,locality,administrative_area,postal_code,country_code,note,rsvp_status,rsvp_party_size`.
- Output starts with the UTF-8 BOM, uses RFC 4180 quoting, and terminates every row with CRLF.
- Text cells that can become spreadsheet formulas are neutralized before escaping.
- Invitation tokens, secure URLs, session/auth data, and internal identifiers never appear.
- Export applies the same bounded search, affiliation, RSVP, and active/archived filters as the list.
- Archived guests are exported only when `view=archived` is explicit.
- PostgreSQL reads pages of 500 in deterministic `created_at DESC, id DESC` order.
- The stream holds no long-lived database transaction or checked-out client between pages.
- Every page independently enforces authenticated wedding membership in SQL.
- API and frontend proxy responses remain `no-store`.

## Review Focus

- A formula prefix hidden behind spaces or tabs is neutralized rather than opened as a spreadsheet formula; Task 1 tests all four prefixes.
- Commas, double quotes, CR/LF, Thai text, and emoji survive an export parse round trip; Task 1 owns the fixture.
- Null optionals become empty cells while numeric zero remains `0`; Task 1 pins cell conversion.
- Client cancellation stops requesting later database pages; Task 3 tests stream cancellation/backpressure.
- Export/list filters produce the same guest IDs and order, including archived and unassigned cases; Task 2 tests both repository paths.

---

### Task 1: Formula-safe RFC 4180 encoder

**Files:**

- Modify: `packages/contracts/src/index.ts`
- Create: `packages/domain/src/guest-csv.ts`
- Create: `packages/domain/src/guest-csv.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**

- Consumes: Guest Management list filters and approved export columns.
- Produces: `GuestCsvRow`, `GUEST_CSV_HEADER`, `encodeGuestCsvHeader()`, and `encodeGuestCsvRow(row)`.

- [ ] **Step 1: Add the export row contract**

```ts
export type GuestCsvRow = {
  name: string;
  email: string | null;
  phone: string | null;
  allowedPartySize: number;
  affiliation: string | null;
  envelopeName: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  locality: string | null;
  administrativeArea: string | null;
  postalCode: string | null;
  countryCode: string | null;
  note: string | null;
  rsvpStatus: Attendance | null;
  rsvpPartySize: number | null;
};
```

- [ ] **Step 2: Write failing encoder tests**

Test the exact BOM/header, CRLF, null/zero handling, every dangerous prefix
`= + - @` with and without leading spaces/tabs, embedded quotes, commas,
multiline cells, Thai names, and emoji. Add a test-only RFC 4180 reader that
parses the produced bytes back into the expected 15 cells without applying
business normalization.

```ts
expect(encodeGuestCsvHeader()).toBe(
  "\uFEFFname,email,phone,allowed_party_size,affiliation,envelope_name,address_line_1,address_line_2,locality,administrative_area,postal_code,country_code,note,rsvp_status,rsvp_party_size\r\n",
);
expect(csvCell(' \t=HYPERLINK("x")')).toBe('"\' \t=HYPERLINK(""x"")"');
```

- [ ] **Step 3: Run the test and confirm RED**

Run:

```bash
npm test -- packages/domain/src/guest-csv.test.ts
```

Expected: FAIL because the encoder does not exist.

- [ ] **Step 4: Implement the encoder**

Use this ordering and policy:

```ts
export const GUEST_CSV_HEADER = [
  "name",
  "email",
  "phone",
  "allowed_party_size",
  "affiliation",
  "envelope_name",
  "address_line_1",
  "address_line_2",
  "locality",
  "administrative_area",
  "postal_code",
  "country_code",
  "note",
  "rsvp_status",
  "rsvp_party_size",
] as const;

export function neutralizeSpreadsheetFormula(value: string): string {
  return /^[\t ]*[=+\-@]/u.test(value) ? "'" + value : value;
}

export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  const text =
    typeof value === "number"
      ? String(value)
      : neutralizeSpreadsheetFormula(value);
  return /[",\r\n]/u.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}
```

`encodeGuestCsvHeader` prepends `\uFEFF`; `encodeGuestCsvRow` never prepends
another BOM and always appends `\r\n`.

- [ ] **Step 5: Run focused checks**

Run:

```bash
npm test -- packages/domain/src/guest-csv.test.ts
npm run typecheck --workspace @lovechapter/domain
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/src/index.ts packages/domain/src/guest-csv.ts packages/domain/src/guest-csv.test.ts packages/domain/src/index.ts
git commit -m "feat: add formula-safe guest CSV encoding"
```

---

### Task 2: Bounded export projection and pagination

**Files:**

- Modify: `packages/domain/src/ports.ts`
- Modify: `packages/database/src/queries.ts`
- Modify: `packages/database/src/query-contract.test.ts`
- Modify: `packages/database/src/repository.ts`
- Modify: `packages/database/src/repository.test.ts`
- Modify: `packages/database/src/guest-affiliations-postgres.integration.ts`

**Interfaces:**

- Consumes: normalized `GuestListInput`, `GuestCsvRow`, and Task 2 guest/address schema from the Guest Management plan.
- Produces: `listGuestExportPage(userId, weddingId, input): Promise<Page<GuestCsvRow & CursorFields>>`.

- [ ] **Step 1: Add the repository page interface**

```ts
export type GuestExportPageRow = GuestCsvRow & {
  cursorCreatedAt: string;
  cursorId: string;
};

listGuestExportPage(
  userId: string,
  weddingId: string,
  input: GuestListRepositoryInput & { limit: 500 },
): Promise<Page<GuestExportPageRow>>;
```

- [ ] **Step 2: Write failing SQL/repository tests**

Assert one query joins address, affiliation, and RSVP once; selects only the 15
export values plus cursor fields; applies membership/wedding/filter/cursor
predicates; orders deterministically; and requests `limit + 1`. Compare IDs
from list and export under active, archived, unassigned, affiliation, RSVP, and
Unicode search filters.

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

```bash
npm test -- packages/database/src/query-contract.test.ts packages/database/src/repository.test.ts
```

Expected: FAIL for absent export query/repository method.

- [ ] **Step 4: Implement the export page query**

Create `buildListGuestExportPageQuery` from the same reusable filter predicate
builder as `buildListGuestsQuery`; do not duplicate filter semantics. Left join
the one-to-zero-or-one address, affiliation, and RSVP records. Return no guest
ID in `GuestCsvRow`; keep IDs only in internal cursor fields.

- [ ] **Step 5: Add PostgreSQL parity coverage**

In the opt-in database suite, seed active/archived, assigned/unassigned, and
RSVP variants. Traverse two pages and assert list/export ID order parity and
tenant isolation.

- [ ] **Step 6: Run focused checks and commit**

Run:

```bash
npm test -- packages/database/src/query-contract.test.ts packages/database/src/repository.test.ts
npm run typecheck --workspace @lovechapter/database
```

Then commit:

```bash
git add packages/domain/src/ports.ts packages/database/src/queries.ts packages/database/src/query-contract.test.ts packages/database/src/repository.ts packages/database/src/repository.test.ts packages/database/src/guest-affiliations-postgres.integration.ts
git commit -m "feat: add bounded guest export pages"
```

---

### Task 3: Streaming CSV download API

**Files:**

- Modify: `packages/domain/src/service.ts`
- Modify: `packages/domain/src/service.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/web/lib/backend-proxy.ts`
- Modify: `apps/web/lib/backend-proxy.test.ts`

**Interfaces:**

- Consumes: Tasks 1–2 encoder and export page repository.
- Produces: `LoveChapterService.streamGuestCsv(weddingId, filters)` and `GET /v1/weddings/:weddingId/guests/export.csv`.

- [ ] **Step 1: Write failing stream and API tests**

Use a fake repository with 501 rows to prove the stream requests pages
sequentially at 500, emits one BOM/header, emits every row once, and does not
request page 2 before page 1 is pulled. Cancel after the first chunk and assert
no further repository call. API tests assert:

```text
200
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="lovechapter-guests.csv"
Cache-Control: no-store
```

Also assert authentication/onboarding/tenant errors retain existing status
mapping.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
npm test -- packages/domain/src/service.test.ts apps/api/src/app.test.ts apps/web/lib/backend-proxy.test.ts
```

Expected: FAIL because the stream/route/header forwarding is absent.

- [ ] **Step 3: Implement a pull-driven stream**

After resolving the onboarded user once, construct a byte stream with one
`TextEncoder`. The first pull enqueues the header; later pulls fetch exactly
one page and enqueue encoded rows. Advance only from the returned cursor and
close on null. A `cancelled` flag prevents new database work after
`cancel()`. Do not open a transaction around the stream.

- [ ] **Step 4: Register the route and proxy header**

Register `/guests/export.csv` before `/guests/:guestId`. Return a native
`Response` with the three headers above. Add `content-disposition` to
`RESPONSE_HEADER_ALLOWLIST` in the same-origin proxy and retain forced
`cache-control: no-store`.

- [ ] **Step 5: Run focused checks and commit**

Run:

```bash
npm test -- packages/domain/src/service.test.ts apps/api/src/app.test.ts apps/web/lib/backend-proxy.test.ts
npm run typecheck --workspace @lovechapter/api
npm run typecheck --workspace @lovechapter/web
```

Then commit:

```bash
git add packages/domain/src/service.ts packages/domain/src/service.test.ts apps/api/src/app.ts apps/api/src/app.test.ts apps/web/lib/backend-proxy.ts apps/web/lib/backend-proxy.test.ts
git commit -m "feat: stream filtered guest CSV exports"
```

---

### Task 4: Export control in the guest workspace

**Files:**

- Modify: `apps/web/lib/api-client.ts`
- Modify: `apps/web/lib/api-client.test.ts`
- Modify: `apps/web/components/guest-management/guest-workspace.tsx`
- Modify: `apps/web/components/guest-management/guest-workspace.test.tsx`

**Interfaces:**

- Consumes: Task 3 download route and current guest filters.
- Produces: authenticated browser download with visible busy/error feedback.

- [ ] **Step 1: Write failing client/component tests**

Assert `downloadGuestCsv(weddingId, filters)` uses the same
`URLSearchParams` helper as listing, checks `response.ok`, reads a `Blob`,
uses the server filename when safe, and revokes the generated object URL after
clicking. Component tests assert current filters are passed, the button is
disabled during download, and API errors are announced without clearing guest
selection.

- [ ] **Step 2: Run focused tests and confirm RED**

Run:

```bash
npm test -- apps/web/lib/api-client.test.ts apps/web/components/guest-management/guest-workspace.test.tsx
```

Expected: FAIL for absent download behavior.

- [ ] **Step 3: Implement the download**

Add a binary-response helper beside `apiRequest`; do not make
`apiRequest<T>` parse CSV as JSON. Name the button “Export filtered CSV” and
add helper text explaining that archived guests export only in Archived view
and invitation links are never included.

- [ ] **Step 4: Run focused checks and commit**

Run:

```bash
npm test -- apps/web/lib/api-client.test.ts apps/web/components/guest-management/guest-workspace.test.tsx
npm run typecheck --workspace @lovechapter/web
```

Then commit:

```bash
git add apps/web/lib/api-client.ts apps/web/lib/api-client.test.ts apps/web/components/guest-management/guest-workspace.tsx apps/web/components/guest-management/guest-workspace.test.tsx
git commit -m "feat: add filtered guest CSV download"
```

---

### Task 5: CSV export release gate

**Files:**

- Modify: `docs/PROGRESS.md`

**Interfaces:**

- Consumes: Tasks 1–4.
- Produces: verified CSV-export slice ready for the import plan.

- [ ] **Step 1: Run the export regression**

Run:

```bash
npm test -- packages/domain/src/guest-csv.test.ts packages/database/src/query-contract.test.ts packages/database/src/repository.test.ts packages/domain/src/service.test.ts apps/api/src/app.test.ts apps/web/lib/backend-proxy.test.ts apps/web/lib/api-client.test.ts apps/web/components/guest-management/guest-workspace.test.tsx
npm run ci
git diff --check
```

Expected: PASS.

- [ ] **Step 2: Manually inspect a spreadsheet fixture**

Download a fixture containing Thai, Latin, emoji, commas, quotes, multiline
notes, null address, and formula-prefix strings. Open it in the target
spreadsheet application and confirm the formula strings display as text. Do not
claim this manual check when the environment cannot open a spreadsheet.

- [ ] **Step 3: Document and commit**

Record automated results and any unrun manual/live-PostgreSQL gate:

```bash
git add docs/PROGRESS.md
git commit -m "docs: record guest CSV export verification"
```
