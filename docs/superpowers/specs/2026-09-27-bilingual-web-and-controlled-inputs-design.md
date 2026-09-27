# Bilingual Web UI and Controlled Standard-Code Inputs

## Intent

Give every browser-facing LoveChapter screen a complete English/Thai language
choice without changing guest invitation URLs, account identity, wedding
formatting preferences, or the selected backend runtime. Replace free-text
entry for standardized codes with human-readable selectors. This is the
foundation for the subsequent wedding-workspace redesign.

The owner approved English and Thai for the **website UI**. English remains the
fallback. This does not limit the product to Thai weddings: user content stays
in its original language, and wedding locale, IANA time zone, ISO currency,
and guest address country remain independent data values.

## Current state and boundaries

- `apps/web/app/layout.tsx` fixes `<html lang="en">`; most React copy is
  embedded in client components. The release proxy serves separate,
  English-only maintenance HTML before React runs.
- Wedding creation accepts typed `locale` and `timeZone`; budget setup accepts
  typed currency; guest address create/edit accepts typed country code.
- `apps/web/app/i/[invitationToken]` and the same-origin API proxy must retain
  their existing paths. Invitation tokens are bearer credentials and must not
  appear in language-switch URLs, analytics, or logs.
- The application keeps one current API/schema contract. Localizing the UI
  does not add language-specific API routes or database columns.

## Language resolution and state

Use the closed set `en | th` for UI messages, with typed dictionaries keyed by
stable semantic identifiers. English defines the key shape; Thai must have
matching keys and placeholders. Values may be text or parameterized functions
for counts/names; never interpolate untrusted content as HTML. Keep React
elements outside the dictionaries when they need links or emphasis.

One server-side resolver is shared by root rendering and maintenance:

1. A valid `lc_ui_language` cookie wins.
2. Otherwise, parse `Accept-Language` with quality and language subtags;
   choose Thai when it is the highest-priority supported language and English
   when English wins.
3. Otherwise, use English. Invalid cookie values are ignored.

Set the cookie only after an explicit switch, through a same-origin route
handler that accepts only `en` or `th`, checks the request origin, and sets
`Path=/`, `SameSite=Lax`, `HttpOnly`, production `Secure`, and a bounded lifetime.
The switch then refreshes the current App Router tree without navigating away
from the current page or invitation token. Requests to the cookie route use a
no-referrer policy so a private invitation URL is not sent as a `Referer`.
No account table or profile setting
is added in this slice; a different device starts from its own browser
preference. Existing pages keep their URLs. The root layout reads the
resolved language, sets `<html lang>`, and provides the dictionary/locale to
client components without a server/client flash. Browser back/forward and
reload preserve the choice.

Language switching is available in the auth shell, authenticated workspace,
public invitation/RSVP, and error states. Maintenance HTML uses the same
resolver and includes a language control that can work without React while
keeping the site closed. The exact cookie-setting route is an explicit
maintenance exception for preference-only writes; it must not reach the API
Worker or application database and must not expose any ordinary page or
business action. Its API response retains the stable `maintenance`
error code and `503` status; it need not translate machine-readable API
responses. Unavailable/invalid invitation pages remain `noindex` and never
expose tokens through the switch.

## Translation coverage

Translate all application-owned visible text in:

- sign-up, sign-in, verification, forgotten/reset password, profile
  onboarding, session/loading/error boundaries, and sign-out;
- wedding creation/selection, planning, guests, affiliations, invitations,
  RSVP status, CSV import/export, envelopes/print, budget/vendors, run sheet,
  and seating;
- public invitation and account-free RSVP, confirmations, empty/loading/error
  states, validation feedback, maintenance, and route/page titles and
  descriptions where they are user-visible.

Map known API error **codes** to localized messages. Unknown or network
errors get a localized safe fallback and must not render an English backend
message into the Thai UI. Do not translate user-entered names, notes,
addresses, CSV content, or identifiers. Email templates and actual email
delivery are out of scope for this website-language change; the current email
language remains English until a separate decision. `LoveChapter` remains the
product name in both languages.

Translations must not change security semantics: auth still uses secure
HTTP-only session cookies, guest RSVP remains account-free, and every browser
API call still goes through the same-origin web proxy. Avoid translating a
raw machine value (token, date, URL, code) that a form submits to the API.

## Formatting and controlled inputs

Use the UI language for interface text and general UI formatting. Use the
wedding's stored `locale` and `timeZone` for wedding dates/times, and the
stored currency for budget amounts; never infer or overwrite those values
when someone switches the UI language. Dates/numbers use `Intl` and explicit
options, not hand-built English/Thai strings. Guest-entered date-only values
remain date-only. Avoid assuming Thailand, Bangkok, THB, or Latin-only names.

Replace these free-text code fields, on both create and edit surfaces, with
accessible searchable comboboxes or bounded native selects:

| Domain field      | Shown to the person                        | Submitted value         |
| ----------------- | ------------------------------------------ | ----------------------- |
| Wedding locale    | language + region name                     | canonical BCP 47 locale |
| Wedding time zone | city/region + UTC offset for a stated date | IANA zone ID            |
| Budget currency   | currency name + ISO code                   | ISO 4217 alpha-3 code   |
| Postal country    | localized country/region name + code       | ISO 3166-1 alpha-2 code |

Use a versioned, non-Thailand-specific standards dataset for locale/country
options and platform `Intl` support where appropriate for labels, currency,
and zones. For time-zone offsets, state the wedding date when available and
otherwise the current date; do not imply a fixed year-round offset. The
implementation plan must pin/verify the data source and bundle
size before code is added. Search must work on name and code, support keyboard
and screen readers, and allow a blank optional postal country. A stored valid
value must render even if absent from a newly curated option list; do not
silently clear customer data. Invalid codes are still rejected by server-side
validation. Choose safe browser-derived defaults only when valid; otherwise
show an explicit choice rather than hardcoding Bangkok or a Thai currency.

The language switch itself is a two-option selector; users must not type `en`
or `th`. Other controlled domain enums already rendered as selects remain
selects; audit adjacent forms for newly exposed raw codes during implementation.

## Testing and release

- Unit-test cookie/Accept-Language precedence, invalid values, quality order,
  dictionary key/placeholder parity, and safe error-code fallback.
- Render-test representative auth, workspace, guest RSVP, validation, and
  maintenance states in both languages. Verify `<html lang>`, page metadata,
  reload persistence, no URL/token change, and no unlocalized app copy in the
  audited route inventory.
- Test selector keyboard behavior, code submission, optional country,
  existing values, invalid server input, and date/time/currency formatting
  across at least a non-Thai locale/time zone.
- Run format, lint, type-check, tests, Next/vinext build and Worker dry-run.
  If any backend validation changes, also test both Bun/VPS and Worker paths.
- This feature has no planned database migration. Its web release still uses
  whole-site maintenance under ADR-029; deploy only the affected Worker when
  the release impact classifier proves web-only, otherwise both.

## Deferred decisions

Account-synced language preference, per-guest language preference, translated
email templates, right-to-left UI translation, and additional interface
languages are separate product slices. The architecture must allow them
without making unsupported translations appear selectable now.
