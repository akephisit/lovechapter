# Wedding Operations: Budget, Vendors, Run Sheet, and Seating

## Intent and scope

Give authenticated members of one wedding a practical workspace for costs,
suppliers, the wedding-day schedule, and table assignments without requiring a
VPS, domain, external payment provider, or public guest page. This extends the
existing planning checklist. Each module has a usable create/edit/delete and
list flow. Only wedding members can access private planning data.

## Shared rules

- All records belong to a wedding and are addressed by a composite wedding/id
  key. SQL authorizes membership for every read and mutation. References among
  vendors, costs, guests, and tables also carry the wedding key.
- The API retains the same-origin browser boundary and first-party sessions.
- Lists are bounded, with a deterministic order; growing lists use a cursor.
  Separate bounded screens may use a documented maximum when their entire set
  is required (e.g. table assignments).
- Keep currency and locale explicit. Store money as safe integer minor units
  with ISO 4217 currency configured once per wedding budget. Users enter
  amounts in major units and UI formats with the wedding locale. Never convert
  currencies implicitly. Preserve exact date-only deadlines and UTC instants.
- Text is Unicode, normalized and bounded. Deletes that would orphan linked
  expense or seat data either detach intentionally or reject explicitly.

## Budget

One budget configuration per wedding holds currency and optional target minor
units. Members create their own budget categories; no seeded categories.
Expenses have title, optional category/vendor, planned and paid minor-unit
amounts, optional payment due date and note. Aggregate planned, paid, and
remaining amounts in SQL, scoped to the wedding. Paid must not exceed planned
unless the member explicitly increases planned. A category can be deleted
without deleting expenses: its expenses become uncategorized. Currency changes
are disallowed once an expense or vendor quote exists to avoid silent
reinterpretation.

## Vendors

Members create contacts with business name, optional contact name, email,
phone, quote amount in the budget currency, booking status, and notes. A
vendor may be linked to an expense. Deleting a vendor leaves expenses intact
and clears their vendor association. Quote values are estimates, not charged
or paid amounts. No file upload or payment integration is implied.

## Wedding-day run sheet

Members create ordered items with title, UTC start/end instants, location,
responsible person as free text, and private note. The UI enters local
date/time in the wedding's IANA time zone and displays in that zone; DST gaps
and ambiguous times must be handled explicitly or rejected. It remains a
private operations schedule; a public guest schedule needs separate approval
and exposure rules. Items can be edited or deleted without changing preparation
checklist tasks.

## Seating

Members create tables with user-defined name and capacity. One active guest
party occupies at most one table. Assignments reserve the guest's allowed
party size, which bounds possible RSVP changes; a declined or archived party
must be unassigned explicitly before its reserved seats are freed. Capacity is
enforced in the database transaction with a table row lock, including
concurrent assignments. Membership, active guest status and table/wedding
identity are checked by the server. Assignments and table deletion must be
atomic; deleting a table removes its assignments after confirmation. The UI
shows reserved and remaining seats and allows assignment/moving/unassignment.
The first slice assigns entire guest parties rather than individual seats or
people; a visual floor-plan editor is a separate product decision.

## Acceptance

- Each of four modules works in the authenticated wedding workspace with
  loading/error/empty states and wedding-switch isolation.
- Invalid dates, currency, money, foreign IDs, nonmembers, overcapacity,
  archived guests and concurrent seat assignments fail safely.
- PostgreSQL migration, SQL authorization and concurrency tests run on a
  disposable PostgreSQL service in CI; provider-free domain/API/UI tests and
  the repository gate pass before claiming completion.

## Open decisions

- Payment transactions, taxes/refunds, multi-currency budgets, vendor document
  storage, guest-visible schedule, per-person seating, and venue/floor-plan
  drawings are not established by this release.
