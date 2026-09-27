# Modern Wedding Workspace and Accurate RSVP Overview

## Intent and dependency

Replace the authenticated page's long stack of wedding form, wedding list,
planning, operations, and guests with a compact, contemporary pink wedding
workspace. A person usually plans one wedding, so opening that wedding should
feel immediate; multiple weddings remain supported without turning the home
screen into a project-management grid. Keep every existing planning and
operations capability reachable. The bilingual web UI and controlled input
spec is the prerequisite; all new copy ships in English and Thai together.

The accepted visual direction is a warm blush/rose background, high-contrast
plum text, refined typography, rounded white surfaces, restrained shadows,
and tasteful interaction motion. This is a product UI, not a copy of the Neon
project list that inspired the compact navigation request.

## Information architecture and states

The page has a compact global header (brand, account, language, sign-out) and
one selected wedding context. On desktop, use a slim section sidebar; on
mobile, a horizontally scrollable labeled section navigation with a visible
selected state. The content area mounts one major section at a time:

| Section  | Existing functionality retained                                                         |
| -------- | --------------------------------------------------------------------------------------- |
| Overview | wedding identity/date, planning progress, RSVP response summary, next practical actions |
| Planning | checklist and its existing filters/create/edit actions                                  |
| Guests   | guest list, affiliations, invitations, RSVP details, CSV import/export, envelopes       |
| Budget   | currency setup, categories, expenses, vendors                                           |
| Schedule | private run sheet                                                                       |
| Seating  | tables and guest-party assignments                                                      |

The overview links to the relevant section; it does not create a second copy
of each editor. Wedding creation and settings move behind prominent but compact
actions, not permanently open forms. One wedding auto-opens. With no weddings,
show a focused creation empty state. With multiple weddings, display a compact
accessible wedding picker and bounded “load more”; preserve server pagination
and never assume the first page contains every wedding. Switching wedding
clears scoped state immediately, ignores stale responses, and remounts
section data by wedding ID. Do not display one wedding's guests, invitations,
financial data, or form drafts under another wedding.

The active section may remain local UI state on the existing `/` route for
this release; avoid new URL structures or invitation-path changes. After a
full reload the section may return to Overview, but account/guest flows must
remain navigable. If unsaved forms would be unmounted by switching section or
wedding, provide a clear confirmation rather than silently discarding input.

## Wedding settings

The selected wedding has a compact Settings action near its identity, opening
an accessible form for its name, optional wedding date, IANA time zone, and
locale. Use the existing controlled locale/time-zone inputs rather than asking
the user to type opaque codes. The wedding's locale describes wedding data and
formatting; it does not silently change the account's Thai/English UI language
preference. The form starts from the selected wedding's current server values.
Clearing the date is supported. Saving updates the wedding picker and overview
without losing the selected wedding or showing a different wedding's data.
Failed saves keep the draft and show a localized retryable error; navigation
away from a dirty form asks before discarding changes.

Use one current shared contract and an authenticated, wedding-scoped endpoint,
for example `PATCH /v1/weddings/:weddingId`, with required `name`, `timeZone`,
and `locale`, plus `weddingDate: string | null` (null clears the date). Return
the updated `WeddingSummary`. Apply the same trim, length, ISO calendar-date,
IANA time-zone, and locale validation as creation. The server must verify both
membership and role for the target wedding on every write: Owner, Couple, and
Planner may edit these fields; Collaborator may view but not edit. Do not trust
a client-supplied role or owner flag. A missing wedding or unauthorized account
must not expose another tenant's values. The UI may hide the edit control for
Collaborator, but backend authorization is definitive. Keep this behavior in
the shared domain/repository path so Bun/VPS and Worker stay equivalent.
The existing schema already stores these fields; no migration is expected.

## Accurate overview data

Planning progress uses the existing wedding-scoped planning-overview API.
RSVP totals must come from a new wedding-scoped, aggregated backend read, not
from `listGuests` (which is paginated). Define a shared contract and route,
for example `GET /v1/weddings/:weddingId/rsvp-summary`, returning integer
counts:

```text
totalActive = number of non-archived guest parties
attending   = active guest parties with latest RSVP attendance=attending
declined    = active guest parties with latest RSVP attendance=declined
replied     = attending + declined
awaiting    = totalActive - replied
```

Counts are guest-party counts, not headcount. The existing one-RSVP-per-guest
invariant determines the latest state; an RSVP update replaces its status.
Archived guests are excluded from every number, even if they previously
replied. No invitation or RSVP is required for an active party to be
`awaiting`. Clearly label zero/empty values and the unit so the UI cannot
mistake parties for people. Do not invent a response percentage when there
are no active guests.

Implement the aggregate in one bounded, parameterized SQL query with wedding
membership checked server-side in SQL. Do not fetch all guest rows or issue
per-guest queries. Inspect generated SQL and the plan against representative
data; use existing indexes unless measurement shows a new index is warranted.
No schema migration is expected for this aggregate. The route and repository
remain shared across the Bun/VPS and Worker backend choices; only the
installation's selected runtime is deployed.

After guest add/archive/restore, invitation/RSVP refresh, or wedding switch,
refresh the summary (or invalidate its scoped cache). Show a non-misleading
loading/last-known state during refresh and a retryable error on failure. Do
not display a stale count as current after switching weddings. Direct guest
RSVP submission remains account-free and unchanged.

## Visual behavior and accessibility

Use the existing Tailwind/shadcn-compatible component layer and design tokens
for rose surfaces, plum text, borders, spacing, and focus; avoid scattering
many one-off hex values. Keep text contrast and focus indicators clear in both
languages. Cards adapt to long Thai/English copy and Unicode user names.
Important content remains readable at 320 px without horizontal page scroll;
only the mobile section navigation may scroll horizontally. Use semantic
nav/main/section landmarks, keyboard-operable controls, active-state labels,
and descriptive headings.

Use short, purposeful transitions for section changes, cards, and controls
(roughly 200–300 ms), no perpetual animation or motion that delays data.
Respect `prefers-reduced-motion`: reduce or remove nonessential transitions.
Loading uses stable skeletons/status text without layout jumps. Avoid
decorative animation that hides errors or blocks action. PWA and release
refresh behavior remain intact; the automatic post-release reload may discard
unsaved drafts, so do not worsen that existing release caveat.

## Authorization, performance, and failure handling

No client-selected wedding ID is an authorization source. Every overview and
section request remains server-authorized to the current account and scoped
to the wedding. Public invitations stay isolated from the authenticated
workspace. One active section should load only the data it needs; bounded
independent reads may run concurrently, but do not prefetch every section on
initial load. Preserve existing cursor pagination for growing collections.
The backend aggregate must not add an N+1 path.

Show retryable, localized failures for wedding-list load, section load, and
overview summary; distinguish a true empty state from an error. Loading and
mutation states must not produce infinite polling. Existing guest CSV,
envelope printing, invitation replacement, planning, budget, run-sheet, and
seating behavior should survive navigation and be regression-tested.

## Testing and release

- UI tests cover zero/one/multiple weddings, load-more, section navigation,
  small viewport, both languages, wedding-switch race, unsaved-form guard,
  no fake data, loading/error/empty, reduced motion, wedding-settings save,
  date clearing, and Collaborator read-only UI.
- Contract/repository/API tests cover empty wedding, active awaiting,
  attending, declined, response update, archived responder, authorization,
  cross-tenant isolation, settings validation, and role-based settings edits.
  Run a representative `EXPLAIN` for the exact aggregate and check no
  unbounded/N+1 access.
- Verify shared tests and both backend paths: Bun API/job build and smoke,
  Worker Wrangler bundle dry-run, and affected HTTP behavior on both where
  locally possible. Run frontend format, lint, type-check, tests, and
  Next/vinext build. Do not call live behavior production-verified until
  exercised there.
- Because the route/contract and web UI change together, classify this as a
  both-Worker production release under ADR-029. Build before maintenance,
  close and drain, deploy the selected backend Worker and web Worker from one
  revision, privately smoke-test, reopen, and perform the public check.
  No database migration is anticipated; if the implementation later needs
  one, review it under the coordinated schema-cutover rules first.

## Out of scope

Multiple active wedding dashboards, public guest scheduling, new RSVP
delivery channels, payment features, seating floor-plan graphics, and a
redesign of email templates are not implied by this workspace change.
