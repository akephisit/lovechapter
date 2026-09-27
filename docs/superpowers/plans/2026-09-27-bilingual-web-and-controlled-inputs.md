# Bilingual Web UI and Controlled Inputs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every browser-facing LoveChapter screen offers complete English/Thai UI text, and standardized locale/time-zone/currency/country fields use validated selections rather than typed codes.

**Architecture:** Resolve one UI language from a server-readable preference cookie or `Accept-Language`, provide a typed two-language dictionary to React, and use the same resolver for pre-React maintenance HTML. Keep the current URL, API, schema, wedding formatting locale, and time zone unchanged. Incrementally replace screen copy and code fields, with each screen group independently testable.

**Tech Stack:** Next.js 16.3.5 App Router, React 19.3.0, TypeScript, Tailwind CSS 4.3.3, vinext 1.0.0-beta.10, Vitest/Testing Library; existing Elysia 2/Drizzle validation stays authoritative.

**Spec:** `docs/superpowers/specs/2026-09-27-bilingual-web-and-controlled-inputs-design.md`

## Global Constraints

- UI languages are exactly `en | th`; English is the fallback. Website language is independent of wedding locale, IANA time zone, and ISO currency.
- Existing `/`, auth, `/i/[invitationToken]`, and same-origin `/api` paths do not change. Never expose invitation tokens through switching or logs.
- No new account-language column, language-specific API path, managed auth provider, backend runtime divergence, or database migration in this plan.
- The cookie is set only by explicit choice and is `HttpOnly`, `SameSite=Lax`, `Path=/`, production `Secure`, with a bounded lifetime. The preference-only setter is the sole maintenance exception.
- No hardcoded Thailand/Bangkok/THB defaults; preserve valid stored codes, Unicode content, and locale/time-zone-aware formatting. Unknown API errors have a localized safe fallback.
- Keep source identifiers, comments, and technical documentation English. Use the same two-language copy for any new UI.
- The owner previously chose native, one-task-at-a-time implementation; no per-task subagent delegation. Push/production deployment remains a separate action after verification and branch review.

## Review Focus

- Malformed cookie plus weighted `Accept-Language`: the supported highest-priority language wins, otherwise English (Task 1 tests).
- Language switch on an invitation URL: the URL/token is unchanged and not sent as a referrer to the preference route (Task 2 tests).
- Maintenance mode: all business paths remain `503` even though the exact language-preference route can set a cookie (Task 2 tests).
- Existing non-curated but valid locale value: selector renders it without clearing it, while a fake country code such as `ZZ` fails server-side (Task 8 tests).
- Thai UI with English wedding locale and non-Thai time zone: labels are Thai while wedding dates/money still use stored settings (Task 9 tests).

---

## File structure and interfaces

- `apps/web/lib/ui-language.ts`: pure `resolveUiLanguage(cookieValue, acceptLanguage): UiLanguage`; defines `UI_LANGUAGE_COOKIE` and valid `UiLanguage`.
- `apps/web/lib/ui-copy.ts`: `getUiCopy(language): UiCopy`; English key shape and typed Thai counterpart. Group keys by common/auth/workspace/guest/operations/error; functions for parameterized copy.
- `apps/web/components/ui-language-provider.tsx`: `UiLanguageProvider({language, children})`, `useUiLanguage()`, `useUiCopy()`; default English only for isolated existing component tests, not for production resolution.
- `apps/web/components/language-switcher.tsx`: accessible two-option control; POSTs to `/ui-language` with `referrerPolicy: "no-referrer"`, then refreshes the current route.
- `apps/web/app/ui-language/route.ts`: validated cookie setter; JSON request returns `204`, form submission redirects to `/` without exposing a private path.
- `apps/web/lib/maintenance-response.ts` and `apps/web/proxy.ts`: shared language resolution for HTML; exact cookie-route exception; API machine codes and maintenance admission stay unchanged.
- `packages/contracts/src/standard-codes.ts`: checked-in ISO country codes and country-language locale candidates sourced from `countries-list@3.4.1`, shared by server validation and browser selections without shipping the full source dataset at runtime.
- `apps/web/lib/standard-options.ts` and `apps/web/components/ui/standard-code-combobox.tsx`: locale/zone/currency/country choices, display labels and code submission. Use `Intl.DisplayNames` for localized labels and `Intl.supportedValuesOf` for currencies/zones, with checked fallbacks if platform support is absent. Cache option generation per language; cap rendered search results.

## Task 1: Pure language resolution and typed copy

**Files:** Create `apps/web/lib/ui-language.ts`, `apps/web/lib/ui-language.test.ts`, `apps/web/lib/ui-copy.ts`, `apps/web/lib/ui-copy.test.ts`.

**Interfaces:** Produces `UiLanguage`, `UI_LANGUAGE_COOKIE`, `resolveUiLanguage(cookieValue: string | null | undefined, acceptLanguage: string | null | undefined): UiLanguage`, and `getUiCopy(language: UiLanguage): UiCopy` for every later task.

- [ ] **Step 1: Write failing tests** named `cookie wins`, `weighted Thai wins`, `q=0 is rejected`, and `unknown falls back`. Pin literal expectations such as `expect(resolveUiLanguage("xx", "th-TH;q=0.9,en-US;q=0.2")).toBe("th")` and `expect(resolveUiLanguage(null, "fr-FR")).toBe("en")`; test recursive dictionary key and parameter shape parity.
- [ ] **Step 2: Verify RED.** Run `npx vitest run apps/web/lib/ui-language.test.ts apps/web/lib/ui-copy.test.ts`; expect missing exports or behavior failures, not test setup errors.
- [ ] **Step 3: Implement** the signatures above. Ignore invalid weights, treat `q=0` as unacceptable, and let English break equal-preference ties. Use typed nested dictionaries; parameterized values are typed functions, not unescaped HTML.
- [ ] **Step 4: Verify GREEN.** Run the focused command, then `npm test`; expect zero failures.
- [ ] **Step 5: Commit** only this task's files with `git commit -m "Add typed English Thai UI language core"`.

## Task 2: Server rendering, switch, and maintenance

**Files:** Create `apps/web/components/ui-language-provider.tsx`, `apps/web/components/language-switcher.tsx`, `apps/web/app/ui-language/route.ts` and tests. Modify `apps/web/app/layout.tsx`, `apps/web/proxy.ts`, `apps/web/lib/maintenance-response.ts` and its tests.

**Interfaces:** Consumes Task 1 resolver/copy. Produces `useUiLanguage(): UiLanguage`, `useUiCopy(): UiCopy`, and the exact `POST /ui-language` preference route for all later screens.

- [ ] **Step 1: Write failing tests** named `Thai cookie sets html lang`, `invalid preference rejects`, `cross-origin preference rejects`, `switch keeps invitation URL`, and `maintenance remains closed`. Assert `lang="th"`, `204` plus `HttpOnly; SameSite=Lax` for a valid JSON POST, no token in the preference request's `Referer`, a `503` on `/api/v1/me`, and a Thai `503` page even after the cookie route is exempted.
- [ ] **Step 2: Verify RED.** Run focused route/provider/maintenance tests; expect missing controls, wrong language, or rejected preference POST.
- [ ] **Step 3: Implement** provider and switch; read async `cookies()`/`headers()` in root, set `<html lang>`, generate localized default metadata; accept JSON and URL-encoded form POSTs, validate same origin, set cookie, return `204` or `303 /`. Proxy exempts only `/ui-language`; maintenance renderer accepts resolved language and keeps no-store `503` for all other paths.
- [ ] **Step 4: Verify GREEN.** Run focused tests and `npm test`; expect zero failures.
- [ ] **Step 5: Commit** with `git commit -m "Persist UI language across web and maintenance"`.

## Task 3: Authentication, onboarding, and error copy

**Files:** Modify `apps/web/components/{auth-form-shell,auth-form-utils,sign-up-form,sign-in-form,verify-email-form,forgot-password-form,reset-password-form,profile-onboarding,auth-error-boundary,auth-session-provider}.tsx` (use `.ts` for `auth-form-utils`), `apps/web/app/(auth)/*/page.tsx`, `apps/web/app/(workspace)/page.tsx`, adjacent tests, and Task 1 dictionary.

**Interfaces:** Consumes `useUiCopy()` and `LanguageSwitcher`; provides localized auth/profile/route states, `passwordLengthError(password, copy)`, and `authErrorMessage(error, copy, fallbackKey)` based on stable API codes.

- [ ] **Step 1: Write failing Thai render/interaction tests** for sign-up, sign-in, verification, password reset, profile onboarding, anonymous/session failure, known/unknown API errors, and localized page title. For example, Thai sign-in has a button named `เข้าสู่ระบบ`, and an unknown `ApiError("raw English", 500)` renders the Thai safe fallback rather than `raw English`; existing English tests retain their behavior.
- [ ] **Step 2: Verify RED.** Run the affected component/page tests; expect English copy or raw backend message where Thai is required.
- [ ] **Step 3: Implement** dictionary-driven visible text and validation while preserving form semantics, token scrubbing, session cookies, and English fallback. Include a language switch on the auth shell and error boundary.
- [ ] **Step 4: Verify GREEN.** Run affected tests and `npm test`; expect zero failures.
- [ ] **Step 5: Commit** with `git commit -m "Localize account and onboarding screens"`.

## Task 4: Public invitation and account-free RSVP

**Files:** Modify `apps/web/components/public-rsvp.tsx`, `apps/web/components/public-rsvp.test.tsx`, `apps/web/app/i/[invitationToken]/page.tsx`, and Task 1 dictionary.

**Interfaces:** Consumes `useUiCopy()`; keeps `PublicRsvpApi`, the token path, wedding formatting data, and RSVP request contract unchanged.

- [ ] **Step 1: Write failing tests** for Thai loading/invitation/form/saved/expired/network-error states, language switching without guest registration, and wedding date rendered using the invitation's stored locale/time zone rather than the UI language. Assert the Thai RSVP action is `ส่งคำตอบ`, the URL stays `/i/<token>`, and the submitted body still uses `attendance: "attending"`.
- [ ] **Step 2: Verify RED.** Run `npx vitest run apps/web/components/public-rsvp.test.ts`; expect untranslated visible text or formatting mismatch.
- [ ] **Step 3: Implement** localized app copy, safe error fallback, switch control, and request-derived page metadata without changing tokens, API calls, or RSVP validation.
- [ ] **Step 4: Verify GREEN.** Run focused tests and `npm test`; expect zero failures.
- [ ] **Step 5: Commit** with `git commit -m "Localize public invitation and RSVP"`.

## Task 5: Wedding shell and planning copy

**Files:** Modify `apps/web/components/{authenticated-home,couple-workspace}.tsx`, `apps/web/components/planning/planning-workspace.tsx`, their tests, and Task 1 dictionary.

**Interfaces:** Consumes `useUiCopy()` and existing API/tenant checks; preserves wedding and planning behavior until the later workspace-redesign plan.

- [ ] **Step 1: Write failing tests** for Thai zero/one/multiple-wedding shell, create/selection/loading/error, planning filters/mutations/empty states, and a language switch that does not alter wedding `locale`/`timeZone`. Assert the create action is `สร้างงานแต่ง`, a selected wedding retains `locale: "en-US"` and `timeZone: "Europe/London"`, and wedding pagination still requests the next cursor.
- [ ] **Step 2: Verify RED.** Run focused couple/planning tests; expect English visible text.
- [ ] **Step 3: Implement** copy and localized error rendering without changing list pagination, wedding-switch generation guards, or planning API behavior.
- [ ] **Step 4: Verify GREEN.** Run focused tests and `npm test`; expect zero failures.
- [ ] **Step 5: Commit** with `git commit -m "Localize wedding and planning screens"`.

## Task 6: Guest management copy

**Files:** Modify `apps/web/components/guest-management/{guest-workspace,guest-list,guest-filters,guest-form,guest-detail-dialog}.tsx`, their tests, and Task 1 dictionary.

**Interfaces:** Consumes `useUiCopy()`; preserves existing guest-scoped APIs and invitation secrecy.

- [ ] **Step 1: Write failing tests** for Thai guest filters, create/edit, invitation replacement, archived views, and unknown API error fallback. Assert a guest search field named `ค้นหาแขก`, unchanged guest `name`/`countryCode` submissions, and no new invitation token in the DOM until the existing create/replace action returns one.
- [ ] **Step 2: Verify RED.** Run focused guest-management tests; expect untranslated states.
- [ ] **Step 3: Implement** translated guest copy and error states; keep guest names, addresses, and API values untouched.
- [ ] **Step 4: Verify GREEN.** Run focused tests and `npm test`; expect zero failures.
- [ ] **Step 5: Commit** with `git commit -m "Localize guest management"`.

## Task 7: CSV import and envelope printing copy

**Files:** Modify `apps/web/components/guest-import/{guest-import-workspace,column-mapping,import-preview-table}.tsx`, `apps/web/components/envelope-print/{envelope-workspace,envelope-template-form,envelope-pages}.tsx`, their tests, and Task 1 dictionary.

**Interfaces:** Consumes `useUiCopy()`; preserves CSV field identifiers, uploaded content, print addresses, and existing API contracts.

- [ ] **Step 1: Write failing tests** for Thai CSV selection/validation/mapping/preview/commit and envelope setup/missing-address warning. Assert the Thai warning `ไม่มีที่อยู่ไปรษณีย์`, while an uploaded `country_code` header and a printed Unicode guest name remain byte-for-byte unchanged.
- [ ] **Step 2: Verify RED.** Run focused guest-import/envelope tests; expect untranslated states.
- [ ] **Step 3: Implement** translated interface copy without translating user-provided CSV rows, address lines, or persisted template codes.
- [ ] **Step 4: Verify GREEN.** Run focused tests and `npm test`; expect zero failures.
- [ ] **Step 5: Commit** with `git commit -m "Localize CSV and envelope workflows"`.

## Task 8: Standard-code selectors and operations copy

**Files:** Create `packages/contracts/src/standard-codes.ts`, `apps/web/lib/standard-options.ts` and tests, `apps/web/components/ui/standard-code-combobox.tsx` and tests. Modify `packages/contracts/src/index.ts`, `packages/domain/src/service.ts` and its tests, `apps/web/components/couple-workspace.tsx`, `apps/web/components/operations/operations-workspace.tsx`, `apps/web/components/guest-management/{guest-form,guest-detail-dialog}.tsx`, adjacent tests, and Task 1 dictionary.

**Interfaces:** Produces `getStandardOptions(kind: "locale" | "timeZone" | "currency" | "country", uiLanguage: UiLanguage, selected?: string, date?: string): Array<{ value: string; label: string }>` and `StandardCodeCombobox({kind, uiLanguage, id, name, defaultValue?, value?, onValueChange?, date?, optional?})`. The combobox searches names/codes, limits visible results, supports keyboard selection, and submits a hidden selected code; arbitrary search text cannot be submitted as a code.

- [ ] **Step 1: Write failing tests** for searchable/keyboard-operable selector, ISO country name/code, IANA zone offset on wedding date versus current date, currency names/codes, locale labels, optional blank country, stored valid value absent from curated choices, and cross-locale wedding formatting. Assert searching `Thailand` or `TH` can select hidden value `TH`, arbitrary search text submits no code, stored `fr-CA` remains selected, and domain validation rejects `ZZ`.
- [ ] **Step 2: Verify RED.** Run focused selector/couple/operations/guest tests; expect typed code inputs or missing options.
- [ ] **Step 3: Implement** from a checked-in, source-labeled ISO list derived from `countries-list@3.4.1` after verifying package data; platform `Intl` lists/labels with a checked fallback; and an accessible combobox with bounded result rendering and separate selected-code submission. Derive browser defaults only after validation; never silently replace stored valid values. Reuse the shared country list for domain validation; preserve existing money/time conversion and backend-runtime parity. Translate operations budget/vendor/run-sheet/seating copy while changing those forms.
- [ ] **Step 4: Verify GREEN.** Run focused tests and `npm test`, then `npm run ci` for Bun/API Worker build and smoke plus web Worker dry-run; expect zero failures.
- [ ] **Step 5: Commit** with `git commit -m "Use localized standard-code selections"`.

## Task 9: Coverage audit and repository gate

**Files:** Modify remaining user-facing copy in `apps/web/app/manifest.ts` and affected route metadata, `apps/web/components/*` only where an audited state remains untranslated; update `docs/PROGRESS.md`, tests, and Task 1 dictionary as needed.

**Interfaces:** Delivers the complete two-language website slice without changing the backend schema/contract.

- [ ] **Step 1: Write failing render tests** for the remaining page-title/manifest and route inventory: auth, workspace, guest, maintenance, print. Assert Thai `<html lang>`, Thai page title/description, and Thai labels alongside an English-formatted date for wedding `locale: "en-US"` and `timeZone: "America/New_York"`; record each uncovered state in a test name rather than grepping source text.
- [ ] **Step 2: Verify RED.** Run the new focused tests; expect the identified untranslated/formatting behavior to fail.
- [ ] **Step 3: Implement** remaining copy/metadata fixes, verify dictionary parity, and update `docs/PROGRESS.md` with evidence and unverified live behavior.
- [ ] **Step 4: Verify GREEN and full gate.** Run `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run ci`, and `git diff --check`; expect exit 0 for each. `npm run ci` includes the Bun smoke, API Worker bundle, Next/vinext builds, and web Worker dry-run. Do not connect to live Neon for tests.
- [ ] **Step 5: Commit** with `git commit -m "Complete bilingual web coverage and verification"`; leave production untouched pending whole-branch review and the approved release flow.

## Self-review against the spec

Tasks 1–2 cover language resolution, persistence, root/maintenance behavior, and security of tokenized URLs. Tasks 3–7 cover every route/component family in the current web inventory. Task 8 covers all four standardized code fields, shared country validation, and preserved valid values. Task 9 checks metadata, formatting separation, accessible/error states, and the full gate for both backend choices. No backend schema migration is planned.
