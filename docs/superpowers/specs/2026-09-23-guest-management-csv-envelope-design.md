# Guest Management, CSV, and Envelope Printing Design

**Date:** 2026-09-23

**Status:** Approved by the owner on 2026-09-23

**Scope:** Complete couple-facing guest management, bounded CSV import/export,
and print-ready envelope layouts

## 1. Objective

Give each wedding a practical guest workspace that supports day-to-day editing,
bulk data exchange, and envelope printing without forcing couples to collect
postal addresses.

The already implemented affiliation foundation remains the grouping model:
affiliations are created, named, colored, ordered, and deleted by each wedding.
There are no hardcoded bride-side or groom-side values. Each guest has at most
one affiliation, each wedding is limited to 100 affiliations, and deleting an
affiliation leaves its guests unassigned.

## 2. Product decisions proposed for approval

- A guest name is the only personal-data field required to create a guest.
- Postal address fields are optional and live behind an advanced mailing
  section. They never block RSVP, invitation links, CSV import, or name-only
  envelope printing.
- `envelopeName` is optional and falls back to the guest name. It lets a couple
  print wording such as “คุณสมชายและครอบครัว” without changing the RSVP name.
- Guest deletion is implemented as recoverable archive/restore. Archiving
  immediately invalidates active invitation links and excludes the guest from
  normal lists, exports, and print jobs.
- CSV import creates guests only in its first release. It does not silently
  update or merge an existing guest.
- CSV duplicate matches are warnings that the user must resolve in preview;
  the system never merges people based only on a name.
- Envelope output is a browser print view, one selected guest per page. The
  first release supports name-only and name-plus-address layouts, common
  envelope presets, and custom millimeter dimensions. Server-generated PDF is
  not required.
- Tags and multi-affiliation membership are outside this phase. A guest keeps
  one optional affiliation.

## 3. Success criteria

The phase is complete when a wedding member can:

- search, filter, paginate, create, edit, archive, and restore guests;
- manage wedding-defined affiliations and see unassigned guests explicitly;
- select guests and perform bounded bulk affiliation or archive actions;
- upload a CSV of at most 1 MiB and 5,000 data rows;
- map columns, preview normalized data, fix or exclude invalid rows, and commit
  the import exactly once;
- export the current filtered guest set as Excel-compatible UTF-8 CSV without
  exposing invitation credentials;
- choose guests, preview an envelope layout, and print name-only envelopes even
  when no address exists;
- optionally print a structured postal address when one was provided;
- keep every read and mutation scoped to authenticated wedding membership.

## 4. Guest data model

### 4.1 Existing fields retained

- `id`, `wedding_id`;
- `name` — required, maximum 120 characters;
- `email` — optional;
- `allowed_party_size` — required, 1 through 20;
- `affiliation_id` — optional composite reference within the same wedding;
- `created_at`.

RSVP and invitation records remain separate.

### 4.2 Guest fields added

- `phone` — optional normalized display value, maximum 40 characters;
- `envelope_name` — optional, maximum 180 characters;
- `note` — optional private couple-facing text, maximum 2,000 characters;
- `archived_at` — nullable timestamp;
- `updated_at` — timestamp maintained on guest changes.

An active-guest index begins with `wedding_id`, filters on
`archived_at is null`, and supports the chosen stable cursor order. Filter
indexes are added only for demonstrated list access patterns rather than every
optional column.

### 4.3 Optional postal address

`guest_postal_addresses` is a one-to-zero-or-one child of a guest and contains:

- `wedding_id`, `guest_id` with a same-wedding composite foreign key;
- `address_line_1` — maximum 180 characters;
- `address_line_2` — optional, maximum 180 characters;
- `locality` — optional city/district, maximum 120 characters;
- `administrative_area` — optional province/state, maximum 120 characters;
- `postal_code` — optional, maximum 32 characters;
- `country_code` — optional ISO 3166-1 alpha-2 code;
- `updated_at`.

An address record requires `address_line_1`, but a guest never requires an
address record. The form labels and CSV help text state this clearly.

## 5. Guest management experience

### 5.1 List

The list provides:

- debounced name/email/phone search;
- affiliation filter including an explicit “Unassigned” option;
- RSVP status filter;
- active or archived view;
- stable cursor pagination;
- row selection for actions on at most 200 guests at a time.

The API returns only fields required by the list. It does not return invitation
tokens or raw secure URLs.

### 5.2 Create and edit

The primary form shows name, email, party allowance, and affiliation. Phone,
envelope wording, note, and postal address are in an optional details section.
Server validation is authoritative and uses the same limits as the contracts.

### 5.3 Archive and restore

Archiving requires confirmation and runs transactionally:

1. authorize the wedding membership and lock the guest;
2. set `archived_at`;
3. expire active invitations for that guest;
4. return the archived summary.

Restore clears `archived_at` but does not reactivate old invitations. A new
invitation must be created explicitly. Permanent deletion is not exposed in
this phase.

### 5.4 Bulk actions

Bulk affiliation assignment and bulk archive accept no more than 200 unique
guest IDs. SQL authorizes and changes the complete set within one wedding; it
rejects cross-wedding or partially missing sets instead of applying a partial
mutation.

## 6. CSV export

`GET /v1/weddings/:weddingId/guests/export.csv` accepts the same bounded
filters as the list and produces a streamed CSV in stable order.

The first row is the versioned header:

```csv
name,email,phone,allowed_party_size,affiliation,envelope_name,address_line_1,address_line_2,locality,administrative_area,postal_code,country_code,note,rsvp_status,rsvp_party_size
```

Rules:

- output is UTF-8 with a BOM for common spreadsheet compatibility;
- fields use RFC 4180 escaping and CRLF rows;
- spreadsheet-formula prefixes (`=`, `+`, `-`, `@`) are neutralized in text
  cells to prevent CSV injection;
- invitation tokens, session data, password data, and secure URLs are excluded;
- archived guests are excluded unless the archived filter is explicit;
- export streams bounded database pages and does not load the whole wedding in
  memory.

## 7. CSV import

### 7.1 Upload boundary

The existing 1 MiB proxy and Bun request limits remain unchanged. The upload
route accepts `text/csv`, rejects compressed/binary input, and allows at most
5,000 non-header rows, 40 columns, and a bounded cell length.

CSV parsing is performed server-side with a maintained streaming parser. The
parser accepts UTF-8 with or without BOM, RFC 4180 quoting, comma delimiters,
and CRLF or LF line endings. Other encodings and delimiters return a clear
validation error rather than guessing.

### 7.2 Staging model

An import is a two-step, durable operation:

- `guest_import_batches` stores wedding, creator, source SHA-256, detected
  headers, mapping, status, row counts, creation time, and expiry;
- `guest_import_rows` stores row number, normalized candidate payload,
  validation messages, duplicate warnings, and inclusion choice.

Staging rows expire after 24 hours and are removed by the bounded job process.
Raw CSV bytes are not retained after parsing.

### 7.3 Mapping and preview

Known English headers are mapped automatically. Every required or optional
field can be remapped before validation. `name` is the only required mapping.

Affiliation values match wedding-defined affiliation names
case-insensitively. Unknown values are shown as errors; the preview lets the
user map them to an existing affiliation, create a new affiliation explicitly,
or exclude the affected rows. Import never invents a hardcoded affiliation.

Validation returns row-level errors and warnings. Duplicate checks cover:

- repeated normalized email within the file;
- repeated normalized name plus phone within the file;
- likely matches to active guests in the same wedding.

Likely matches are warnings, not automatic merges. The preview displays totals
for valid, warning, invalid, and excluded rows.

### 7.4 Commit

Commit accepts the batch ID, mapping version, included row IDs, explicit
duplicate decisions, and an idempotency key. It locks the batch, verifies that
the mapping and preview have not changed, creates no more than 5,000 guests in
set-based chunks within one transaction, and marks the batch committed.

Retrying the same idempotency key returns the original result. A validation or
database failure creates no guests. The response reports created and excluded
counts plus the created guest IDs; it never returns invitation tokens.

## 8. Envelope printing

### 8.1 Selection

The print workspace starts from current guest filters or an explicit selection.
It supports at most 500 envelopes per browser print job. Archived guests are
not printable. The user can choose:

- name only;
- name and postal address.

`envelope_name` falls back to `name`. Missing addresses are highlighted in the
preview only when the address layout is selected; they never block name-only
printing.

### 8.2 Layout

Initial size presets are:

| Preset |  Width | Height |
| ------ | -----: | -----: |
| DL     | 220 mm | 110 mm |
| C5     | 229 mm | 162 mm |
| C6     | 162 mm | 114 mm |

Custom dimensions allow 90–330 mm width and 55–480 mm height. The user chooses
portrait/landscape, safe margins, horizontal alignment, font size, line
spacing, and whether to show the address. Font choices are a small tested set
with Thai and Latin coverage.

Each guest renders as one print page. Print CSS uses millimeter dimensions,
zeroes browser content margins, hides application controls, preserves text
contrast, and waits for `document.fonts.ready` before enabling Print. The
preview warns that printer drivers may impose non-printable margins and asks
for one test envelope before a large run.

### 8.3 Saved templates

`envelope_print_templates` stores wedding-scoped template name, dimensions,
orientation, margins, typography, alignment, address visibility, and timestamps.
Template payloads are server-validated against an explicit schema; arbitrary
HTML, CSS, remote fonts, images, and scripts are not stored.

The first release uses browser print/PDF output. A server PDF renderer can be
added later only if browser/printer testing demonstrates inconsistent output.

## 9. API surface

All routes require an authenticated wedding member and resolve wedding scope
in SQL.

### Guests

- `GET /v1/weddings/:weddingId/guests`
- `POST /v1/weddings/:weddingId/guests`
- `PATCH /v1/weddings/:weddingId/guests/:guestId`
- `POST /v1/weddings/:weddingId/guests/:guestId/archive`
- `POST /v1/weddings/:weddingId/guests/:guestId/restore`
- `PATCH /v1/weddings/:weddingId/guests/bulk-affiliation`
- `POST /v1/weddings/:weddingId/guests/bulk-archive`

### CSV

- `GET /v1/weddings/:weddingId/guests/export.csv`
- `POST /v1/weddings/:weddingId/guest-imports`
- `PATCH /v1/weddings/:weddingId/guest-imports/:batchId/mapping`
- `POST /v1/weddings/:weddingId/guest-imports/:batchId/commit`

### Print templates and data

- `GET /v1/weddings/:weddingId/envelope-templates`
- `POST /v1/weddings/:weddingId/envelope-templates`
- `PATCH /v1/weddings/:weddingId/envelope-templates/:templateId`
- `DELETE /v1/weddings/:weddingId/envelope-templates/:templateId`
- `POST /v1/weddings/:weddingId/envelope-print-data`

The print-data route accepts no more than 500 unique guest IDs and returns only
the chosen template plus envelope name and optional postal fields.

## 10. Security, privacy, and performance

- Tenant authorization is present in every read and write query.
- CSV formula neutralization is tested on import previews and exports.
- Import content is never logged; API errors contain row numbers, not full
  personal-data rows.
- Raw CSV files are discarded after parsing, and staged normalized rows expire.
- Import, bulk, export, and print endpoints have explicit row/count limits.
- Listing uses stable cursor pagination and a bounded search query.
- Export reads in pages and streams the response with backpressure.
- Import commit uses set-based inserts rather than one database round trip per
  row.
- Envelope rendering contains text nodes only; no user-provided HTML is used.

## 11. Verification

Required automated coverage includes:

- cross-wedding authorization failures for every guest, import, and template
  mutation;
- guest edit, archive, restore, invitation invalidation, filter, and cursor
  behavior;
- CSV quoting, BOM, Unicode Thai names, malformed input, limits, duplicate
  warnings, mapping, atomic commit, and idempotent retry;
- CSV injection cases for every dangerous formula prefix;
- export round-trip of supported fields;
- name-only printing without an address;
- address-layout warnings, preset/custom page dimensions, Thai font rendering,
  selection limits, and print-only CSS;
- query contract tests proving bounded set operations and tenant predicates;
- migration snapshot validation and live PostgreSQL concurrency checks before
  production deployment.

Manual acceptance uses at least one real envelope from each intended printer
path because browser preview cannot prove printer feed alignment.

## 12. Delivery slices after approval

1. Guest edit/archive/restore, search/filter, and bounded bulk actions.
2. CSV export and formula-safe round-trip fixtures.
3. Durable CSV staging, mapping preview, and atomic import commit.
4. Envelope data, saved templates, preview, and browser print flow.
5. Full regression, live database gates, documentation, and release review.

Implementation planning starts only after the owner reviews the product
decisions in section 2, especially archive behavior, creation-only import, and
browser-based envelope printing.

Approved implementation plans:

- `docs/superpowers/plans/2026-09-23-guest-management.md`
- `docs/superpowers/plans/2026-09-23-guest-csv-export.md`
- `docs/superpowers/plans/2026-09-23-guest-csv-import.md`
- `docs/superpowers/plans/2026-09-23-envelope-printing.md`
