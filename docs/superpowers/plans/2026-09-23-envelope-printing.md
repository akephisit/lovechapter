# Envelope Printing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let wedding members select active guests, configure or save a safe envelope layout, preview name-only or name-plus-address pages, and print one envelope per browser page.

**Architecture:** Server-validated template records store only explicit numeric/enum fields. One tenant-scoped print-data query preserves the requested guest order and returns envelope text plus optional structured addresses for at most 500 active guests. React renders text nodes into millimeter-sized pages; a pure CSS builder accepts only already-validated values, and Print unlocks after self-hosted Thai/Latin fonts are ready.

**Tech Stack:** TypeScript 6.0.3, Elysia 2.0.0-beta.16, Drizzle ORM 0.45.3, PostgreSQL, React 19.3.0, Next.js 16.3.5, @fontsource-variable Noto Thai packages 5.3.0, CSS Paged Media, Vitest 5.0.1

**Spec:** `docs/superpowers/specs/2026-09-23-guest-management-csv-envelope-design.md`

## Global Constraints

- Name-only printing works with no postal address and uses `envelopeName ?? name`.
- Address mode highlights missing addresses in preview but does not affect name-only jobs.
- A print request contains 1–500 unique active guest IDs; archived guests are rejected.
- Presets are DL 220×110 mm, C5 229×162 mm, and C6 162×114 mm.
- Custom size is integer millimeters: width 90–330 and height 55–480.
- Templates store only validated dimensions, orientation, four safe margins, alignment, font family/size, line spacing, and address visibility.
- No arbitrary HTML, CSS, remote font, image, or script is accepted or stored.
- Every guest/template query applies membership and wedding scope in SQL.
- Each guest renders as one print page; application controls are hidden in print.
- Browser printing is the first release; no server PDF renderer is added.
- The UI warns about printer non-printable margins and asks for one physical test envelope.

## Review Focus

- A guest without an address prints normally in name-only mode and becomes a visible warning only in address mode; Tasks 3 and 5 pin both paths.
- Cross-wedding, missing, duplicate, archived, or 501-item print selections return no partial data; Task 3 pins the all-or-nothing query.
- User names/addresses containing markup render as text and cannot inject HTML/CSS; Tasks 4 and 5 test hostile strings.
- Orientation, custom dimensions, margins, font size, and line spacing cannot escape validated CSS ranges or produce `NaN`; Tasks 1 and 4 pin the builder.
- Print cannot run before `document.fonts.ready`, and a failed font readiness leaves the preview retryable; Task 5 owns the browser behavior.

---

### Task 1: Envelope template contracts and validation

**Files:**

- Modify: `packages/contracts/src/index.ts`
- Create: `packages/domain/src/envelope-printing.ts`
- Create: `packages/domain/src/envelope-printing.test.ts`
- Modify: `packages/domain/src/index.ts`
- Modify: `packages/domain/src/service.ts`
- Modify: `packages/domain/src/service.test.ts`
- Modify: `packages/domain/src/ports.ts`

**Interfaces:**

- Consumes: wedding membership and guest/address data from Guest Management.
- Produces: validated template/input/print-data types used by Tasks 2–5.

- [ ] **Step 1: Define exact public contracts**

```ts
export const ENVELOPE_ORIENTATIONS = ["landscape", "portrait"] as const;
export const ENVELOPE_ALIGNMENTS = ["left", "center", "right"] as const;
export const ENVELOPE_FONT_FAMILIES = [
  "noto-sans-thai",
  "noto-serif-thai",
] as const;

export type EnvelopeTemplateInput = {
  name: string;
  widthMm: number;
  heightMm: number;
  orientation: (typeof ENVELOPE_ORIENTATIONS)[number];
  marginTopMm: number;
  marginRightMm: number;
  marginBottomMm: number;
  marginLeftMm: number;
  alignment: (typeof ENVELOPE_ALIGNMENTS)[number];
  fontFamily: (typeof ENVELOPE_FONT_FAMILIES)[number];
  fontSizePt: number;
  lineSpacingPercent: number;
  showAddress: boolean;
};

export type EnvelopeTemplate = EnvelopeTemplateInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

export type EnvelopePrintGuest = {
  id: string;
  envelopeName: string;
  postalAddress: PostalAddressInput | null;
};

export type EnvelopePrintDataInput = {
  guestIds: string[];
  templateId?: string;
  template?: EnvelopeTemplateInput;
};

export type EnvelopePrintData = {
  template: EnvelopeTemplateInput;
  guests: EnvelopePrintGuest[];
};

export const ENVELOPE_PRESETS = {
  DL: { widthMm: 220, heightMm: 110 },
  C5: { widthMm: 229, heightMm: 162 },
  C6: { widthMm: 162, heightMm: 114 },
} as const;
```

- [ ] **Step 2: Write failing validation tests**

Cover every min/max, integer requirement, enum, trimmed 1–80 template name,
margin non-negativity, horizontal/vertical margins leaving at least 20 mm of
usable width/height, 8–72 pt font size, 80–250% line spacing, exactly one of
`templateId/template`, 1/500/501 IDs, duplicate IDs, and all three presets.

```ts
expect(ENVELOPE_PRESETS).toEqual({
  DL: { widthMm: 220, heightMm: 110 },
  C5: { widthMm: 229, heightMm: 162 },
  C6: { widthMm: 162, heightMm: 114 },
});
```

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

```bash
npm test -- packages/domain/src/envelope-printing.test.ts packages/domain/src/service.test.ts
```

Expected: FAIL because envelope types/validation/service methods are absent.

- [ ] **Step 4: Implement pure normalization and service methods**

Export `normalizeEnvelopeTemplateInput` and `normalizeEnvelopePrintDataInput`.
Add service methods:

```ts
listEnvelopeTemplates(weddingId: string): Promise<EnvelopeTemplate[]>;
createEnvelopeTemplate(
  weddingId: string,
  input: EnvelopeTemplateInput,
): Promise<EnvelopeTemplate>;
updateEnvelopeTemplate(
  weddingId: string,
  templateId: string,
  input: EnvelopeTemplateInput,
): Promise<EnvelopeTemplate>;
deleteEnvelopeTemplate(weddingId: string, templateId: string): Promise<void>;
getEnvelopePrintData(
  weddingId: string,
  input: EnvelopePrintDataInput,
): Promise<EnvelopePrintData>;
```

All methods require an onboarded user before calling repository ports.

Define the repository boundary used by those methods:

```ts
export interface EnvelopeRepository {
  listEnvelopeTemplates(
    userId: string,
    weddingId: string,
  ): Promise<EnvelopeTemplate[]>;
  createEnvelopeTemplate(
    userId: string,
    weddingId: string,
    id: string,
    input: EnvelopeTemplateInput,
  ): Promise<EnvelopeTemplate>;
  updateEnvelopeTemplate(
    userId: string,
    weddingId: string,
    templateId: string,
    input: EnvelopeTemplateInput,
  ): Promise<EnvelopeTemplate>;
  deleteEnvelopeTemplate(
    userId: string,
    weddingId: string,
    templateId: string,
  ): Promise<void>;
  getEnvelopePrintData(
    userId: string,
    weddingId: string,
    input: EnvelopePrintDataInput,
  ): Promise<EnvelopePrintData>;
}
```

- [ ] **Step 5: Run focused checks and commit**

Run:

```bash
npm test -- packages/domain/src/envelope-printing.test.ts packages/domain/src/service.test.ts
npm run typecheck --workspace @lovechapter/contracts
npm run typecheck --workspace @lovechapter/domain
```

Then commit:

```bash
git add packages/contracts/src/index.ts packages/domain/src/envelope-printing.ts packages/domain/src/envelope-printing.test.ts packages/domain/src/index.ts packages/domain/src/service.ts packages/domain/src/service.test.ts packages/domain/src/ports.ts
git commit -m "feat: define safe envelope print templates"
```

---

### Task 2: Wedding-scoped saved templates

**Files:**

- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/schema.test.ts`
- Create: generated `packages/database/drizzle/0006_*.sql`
- Create: generated `packages/database/drizzle/meta/0006_snapshot.json`
- Modify: `packages/database/drizzle/meta/_journal.json`
- Create: `packages/database/src/envelope-queries.ts`
- Create: `packages/database/src/envelope-query-contract.test.ts`
- Create: `packages/database/src/envelope-repository.ts`
- Create: `packages/database/src/envelope-repository.test.ts`
- Modify: `packages/database/src/client.ts`
- Modify: `packages/database/src/index.ts`

**Interfaces:**

- Consumes: Task 1 repository/template types.
- Produces: wedding-scoped template CRUD capped at 50 saved templates.

- [ ] **Step 1: Write failing schema tests**

Assert composite key `(wedding_id, id)`, case-insensitive unique template name
per wedding, all explicit columns, width/height/font/spacing/margin checks,
enum checks, timestamps, and ordered list index
`(wedding_id, updated_at DESC, id DESC)`.

- [ ] **Step 2: Run schema test and confirm RED**

Run:

```bash
npm test -- packages/database/src/schema.test.ts
```

Expected: FAIL because `envelope_print_templates` is absent.

- [ ] **Step 3: Implement schema and migration**

Use integer millimeters/points/percent and booleans; do not store a free-form
JSON style blob. Generate and inspect migration:

```bash
npm run db:generate --workspace @lovechapter/database
npm run db:check --workspace @lovechapter/database
```

- [ ] **Step 4: Write failing query/repository tests**

Pin membership scope in every operation, deterministic bounded list, wedding-row
lock before 50-template count/insert, same-wedding update/delete, duplicate-name
conflict mapping, and cross-wedding 404.

- [ ] **Step 5: Implement template CRUD**

Create `PostgresEnvelopeRepository` from the existing process-wide
`QueryExecutor`. List all templates only because the per-wedding count is
strictly capped at 50. Serialize creation under the authorized wedding lock so
concurrent requests cannot exceed the limit.

- [ ] **Step 6: Run focused checks and commit**

Run:

```bash
npm test -- packages/database/src/schema.test.ts packages/database/src/envelope-query-contract.test.ts packages/database/src/envelope-repository.test.ts
npm run db:check --workspace @lovechapter/database
npm run typecheck --workspace @lovechapter/database
```

Then commit:

```bash
git add packages/database/src/schema.ts packages/database/src/schema.test.ts packages/database/drizzle packages/database/src/envelope-queries.ts packages/database/src/envelope-query-contract.test.ts packages/database/src/envelope-repository.ts packages/database/src/envelope-repository.test.ts packages/database/src/client.ts packages/database/src/index.ts
git commit -m "feat: persist wedding envelope templates"
```

---

### Task 3: Print data query and envelope API

**Files:**

- Modify: `packages/domain/src/ports.ts`
- Modify: `packages/domain/src/service.ts`
- Modify: `packages/domain/src/service.test.ts`
- Modify: `packages/database/src/envelope-queries.ts`
- Modify: `packages/database/src/envelope-query-contract.test.ts`
- Modify: `packages/database/src/envelope-repository.ts`
- Modify: `packages/database/src/envelope-repository.test.ts`
- Create: `packages/database/src/envelope-postgres.integration.ts`
- Modify: `packages/database/vitest.postgres.config.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/api/src/server.ts`

**Interfaces:**

- Consumes: saved or inline validated template and 1–500 guest IDs.
- Produces: template CRUD routes and all-or-nothing ordered print data.

- [ ] **Step 1: Write failing SQL/repository tests**

For print data, require one parameterized `unnest($n::uuid[]) WITH ORDINALITY`
query that joins membership, active guests, and optional address; preserves
request order; uses `COALESCE(NULLIF(envelope_name, ''), name)`; and returns
data only when matched count equals unique requested count. Test duplicate,
missing, archived, and cross-wedding IDs return no partial rows.

- [ ] **Step 2: Write failing service/API tests**

Routes:

```text
GET    /v1/weddings/:weddingId/envelope-templates
POST   /v1/weddings/:weddingId/envelope-templates
PATCH  /v1/weddings/:weddingId/envelope-templates/:templateId
DELETE /v1/weddings/:weddingId/envelope-templates/:templateId
POST   /v1/weddings/:weddingId/envelope-print-data
```

Assert 201/200/204 statuses, strict additional-property rejection, template
XOR validation, 500 limit, name fallback, optional address, and 404 tenant
behavior.

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

```bash
npm test -- packages/database/src/envelope-query-contract.test.ts packages/database/src/envelope-repository.test.ts packages/domain/src/service.test.ts apps/api/src/app.test.ts
```

Expected: FAIL for absent query/routes.

- [ ] **Step 4: Implement print data and routes**

When `templateId` is supplied, load it through the same wedding membership
scope. When inline `template` is supplied, use the already-normalized value
without persistence. Query guests once, compare row count to requested count,
and map address only when line 1 exists.

Inject `EnvelopeRepository` into `LoveChapterService` and wire
`postgres.envelopeRepository` from the existing process-wide runtime in
`apps/api/src/server.ts`; do not create another database pool.

- [ ] **Step 5: Add live PostgreSQL isolation coverage**

Verify cross-wedding/template/guest isolation, input order preservation,
archived rejection, missing address success, and a 500-row print query. Keep
the explicit disposable database guard.

- [ ] **Step 6: Run focused checks and commit**

Run:

```bash
npm test -- packages/database/src/envelope-query-contract.test.ts packages/database/src/envelope-repository.test.ts packages/domain/src/service.test.ts apps/api/src/app.test.ts
npm run typecheck --workspace @lovechapter/database
npm run typecheck --workspace @lovechapter/api
```

Then commit:

```bash
git add packages/domain/src/ports.ts packages/domain/src/service.ts packages/domain/src/service.test.ts packages/database/src/envelope-queries.ts packages/database/src/envelope-query-contract.test.ts packages/database/src/envelope-repository.ts packages/database/src/envelope-repository.test.ts packages/database/src/envelope-postgres.integration.ts packages/database/vitest.postgres.config.ts apps/api/src/app.ts apps/api/src/app.test.ts apps/api/src/server.ts
git commit -m "feat: expose secure envelope print data"
```

---

### Task 4: Self-hosted fonts and safe print renderer

**Files:**

- Modify: `apps/web/package.json`
- Modify: `package-lock.json`
- Modify: `apps/web/app/globals.css`
- Create: `apps/web/lib/envelope-print.ts`
- Create: `apps/web/lib/envelope-print.test.ts`
- Create: `apps/web/components/envelope-print/envelope-pages.tsx`
- Create: `apps/web/components/envelope-print/envelope-pages.test.tsx`

**Interfaces:**

- Consumes: validated `EnvelopePrintData`.
- Produces: sanitized print CSS and one text-only page per guest.

- [ ] **Step 1: Install self-hosted Thai/Latin fonts**

Run:

```bash
npm install @fontsource-variable/noto-sans-thai@5.3.0 @fontsource-variable/noto-serif-thai@5.3.0 --workspace @lovechapter/web
```

Import only the required variable-weight CSS from the root stylesheet. No
remote font request is allowed at print time.

- [ ] **Step 2: Write failing CSS-builder tests**

For DL/C5/C6 and min/max custom input, assert exact millimeter page size,
orientation-adjusted dimensions, zero `@page` margin, safe margins,
alignment, whitelisted font-family token, point size, percentage line height,
high-contrast text, controls hidden, and page break after each non-final sheet.
Pass hostile names/addresses and assert the component renders text content with
no injected element/style.

- [ ] **Step 3: Run tests and confirm RED**

Run:

```bash
npm test -- apps/web/lib/envelope-print.test.ts apps/web/components/envelope-print/envelope-pages.test.tsx
```

Expected: FAIL because the renderer does not exist.

- [ ] **Step 4: Implement the pure CSS builder**

Export:

```ts
export function envelopePageDimensions(template: EnvelopeTemplateInput): {
  widthMm: number;
  heightMm: number;
};

export function buildEnvelopePrintCss(template: EnvelopeTemplateInput): string;
```

Map font enums to constant CSS family strings. Format only finite validated
integers into CSS. Do not interpolate template names or guest data into style
text.

- [ ] **Step 5: Implement text-only pages**

Render `envelopeName` and address parts as normal React children. In address
mode, join present address fields in semantic lines and mark guests with no
address using a preview-only warning that is hidden in print. In name-only mode,
never require/read address fields for eligibility.

- [ ] **Step 6: Run focused checks and commit**

Run:

```bash
npm test -- apps/web/lib/envelope-print.test.ts apps/web/components/envelope-print/envelope-pages.test.tsx
npm run typecheck --workspace @lovechapter/web
```

Then commit:

```bash
git add apps/web/package.json package-lock.json apps/web/app/globals.css apps/web/lib/envelope-print.ts apps/web/lib/envelope-print.test.ts apps/web/components/envelope-print/envelope-pages.tsx apps/web/components/envelope-print/envelope-pages.test.tsx
git commit -m "feat: render print-safe envelope pages"
```

---

### Task 5: Envelope selection, template editor, preview, and Print

**Files:**

- Modify: `apps/web/lib/api-client.ts`
- Modify: `apps/web/lib/api-client.test.ts`
- Create: `apps/web/components/envelope-print/envelope-workspace.tsx`
- Create: `apps/web/components/envelope-print/envelope-workspace.test.tsx`
- Create: `apps/web/components/envelope-print/envelope-template-form.tsx`
- Modify: `apps/web/components/guest-management/guest-workspace.tsx`
- Modify: `apps/web/components/guest-management/guest-workspace.test.tsx`

**Interfaces:**

- Consumes: Task 3 API and Task 4 renderer.
- Produces: guest selection up to 500, preset/custom template editing, save CRUD, preview, and guarded browser print.

- [ ] **Step 1: Write failing API-client tests**

Add and test `listEnvelopeTemplates`, `createEnvelopeTemplate`,
`updateEnvelopeTemplate`, `deleteEnvelopeTemplate`, and
`getEnvelopePrintData` with exact methods/paths and JSON bodies.

- [ ] **Step 2: Write failing workspace tests**

Cover:

- add loaded active guests or individual rows to a distinct print selection;
- archived guests cannot enter the print selection;
- 500 selected succeeds and 501st is rejected;
- DL/C5/C6 populate exact dimensions;
- custom values validate before API calls;
- name-only preview works for a no-address guest;
- address mode shows a missing-address warning and still allows removing that
  guest or switching back to name-only;
- save/rename/delete template with confirmation;
- printer-margin/test-envelope warning stays visible;
- Print remains disabled until `document.fonts.ready` resolves;
- Print invokes `window.print()` once and restores controls afterward;
- rejected font readiness shows retryable error and never prints.

- [ ] **Step 3: Run focused tests and confirm RED**

Run:

```bash
npm test -- apps/web/lib/api-client.test.ts apps/web/components/envelope-print/envelope-workspace.test.tsx apps/web/components/guest-management/guest-workspace.test.tsx
```

Expected: FAIL because the client/workspace is absent.

- [ ] **Step 4: Implement client and workspace**

Keep bulk-action selection (max 200) separate from print selection (max 500).
Open `EnvelopeWorkspace` from the guest toolbar, seeded only with active guest
IDs. Fetch print data whenever guest selection or chosen template changes,
using request generation guards so stale preview responses cannot overwrite
newer choices.

The editor exposes preset, orientation, four margins, alignment, two fonts,
font size, line spacing, and address toggle. It never exposes raw CSS.

- [ ] **Step 5: Implement guarded Print**

```ts
async function printEnvelopes(): Promise<void> {
  setPreparing(true);
  try {
    await document.fonts.ready;
    window.print();
  } finally {
    setPreparing(false);
  }
}
```

Handle readiness rejection before calling `window.print`. Keep the test-print
warning and selected envelope count visible outside print media.

- [ ] **Step 6: Run focused checks and commit**

Run:

```bash
npm test -- apps/web/lib/api-client.test.ts apps/web/components/envelope-print/envelope-workspace.test.tsx apps/web/components/guest-management/guest-workspace.test.tsx
npm run typecheck --workspace @lovechapter/web
```

Then commit:

```bash
git add apps/web/lib/api-client.ts apps/web/lib/api-client.test.ts apps/web/components/envelope-print apps/web/components/guest-management/guest-workspace.tsx apps/web/components/guest-management/guest-workspace.test.tsx
git commit -m "feat: add browser envelope print workspace"
```

---

### Task 6: Envelope-printing release gate

**Files:**

- Modify: `PROJECT_CONTEXT.md`
- Modify: `docs/PROGRESS.md`
- Modify: `docs/DECISIONS.md`

**Interfaces:**

- Consumes: Tasks 1–5 and all earlier guest/CSV slices.
- Produces: verified full phase and documented physical-printer acceptance gate.

- [ ] **Step 1: Run envelope and full regressions**

Run:

```bash
npm test -- packages/domain/src/envelope-printing.test.ts packages/database/src/envelope-query-contract.test.ts packages/database/src/envelope-repository.test.ts packages/domain/src/service.test.ts apps/api/src/app.test.ts apps/web/lib/envelope-print.test.ts apps/web/components/envelope-print/envelope-pages.test.tsx apps/web/components/envelope-print/envelope-workspace.test.tsx
npm run ci
git diff --check
```

Expected: all provider-free checks PASS.

- [ ] **Step 2: Verify print build artifacts**

Confirm native Next and vinext/Cloudflare builds include both self-hosted font
families, no remote font URL, no client secret, and no unsupported dynamic CSS
input. Check the print preview at 100% browser zoom for DL, C5, C6, minimum, and
maximum custom sizes.

- [ ] **Step 3: Perform or record manual physical acceptance**

For each intended browser/printer path, print one real test envelope before a
large run and record feed orientation, scaling set to 100%/Actual size, and any
driver-imposed non-printable margin. If hardware is unavailable, list this as a
required external acceptance gate rather than claiming success.

- [ ] **Step 4: Update documentation and commit**

Record browser-based output, template bounds, self-hosted fonts, automated
evidence, and unrun hardware/live-PostgreSQL gates:

```bash
git add PROJECT_CONTEXT.md docs/PROGRESS.md docs/DECISIONS.md
git commit -m "docs: record envelope printing verification"
```
