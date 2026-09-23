# Wedding Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add complete first-slice budget, vendor, wedding-day schedule, and table-assignment management to each wedding.

**Architecture:** Follow the planning checklist's contracts → domain normalization and service → SQL repository → Elysia API → same-origin web client → keyed couple workspace pattern. Use separate wedding-scoped tables, bounded SQL and a transactional seating invariant.

**Tech Stack:** TypeScript 6, Elysia 2, Drizzle/PostgreSQL 16, Next/React, Vitest, Bun CI.

**Spec:** `docs/superpowers/specs/2026-09-23-wedding-operations-design.md`

## Task 1 — Budget and vendor domain and persistence

- [ ] Write failing domain tests for currency, minor units, nullable text/date and supplier data; run RED.
- [ ] Add contracts, normalizers, repository port, service operations; run focused GREEN.
- [ ] Write failing SQL contract/schema tests for membership, composite references and bounded access; run RED.
- [ ] Add schema, SQL, repository and migration; run focused GREEN and `db:check`.
- [ ] Add disposable PostgreSQL integration coverage for money, referential integrity, and tenant isolation.

## Task 2 — Budget and vendor endpoints and web controls

- [ ] Write failing API/client tests for validated CRUD and authorization; run RED.
- [ ] Add API routes, runtime dependency, client methods; run focused GREEN.
- [ ] Write failing UI interaction tests for creation, editing, errors and wedding switch; run RED.
- [ ] Add member workspace budget and vendor controls; run focused GREEN.

## Task 3 — Wedding-day run sheet

- [ ] Write failing date/time and access tests; run RED.
- [ ] Add contracts, normalizer, schema, SQL, service and migration; run focused GREEN.
- [ ] Add API/client tests then endpoints; add UI tests then the private local-time schedule editor.
- [ ] Cover tenant isolation and precise UTC instant ordering in PostgreSQL CI.

## Task 4 — Seating

- [ ] Write failing capacity/foreign-guest/concurrency tests; run RED.
- [ ] Add composite wedding/guest/table constraints, locking assignment transaction and bounded list queries; run focused GREEN.
- [ ] Add API/client tests then endpoints; UI tests then table and guest-assignment controls.
- [ ] Run disposable PostgreSQL concurrent assignment tests.

## Task 5 — End-to-end gate and PR

- [ ] Run format, lint, typecheck, provider-free tests, migration check, diff check; fix failures.
- [ ] Update `docs/PROGRESS.md`, `docs/OPEN_QUESTIONS.md`, verify whole-branch changes.
- [ ] Commit and push to PR #2, confirm PostgreSQL and Verify CI jobs pass, and update PR description.
