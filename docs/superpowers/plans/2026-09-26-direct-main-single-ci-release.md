# Direct-Main Single-CI Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner commit in an isolated worktree and push directly to protected `main` without a PR, reviewer, or branch CI, while one exact-SHA hosted CI gate precedes any Worker release.

**Architecture:** Keep `.github/workflows/release.yml` as the sole hosted `main` pipeline: its CI and PostgreSQL jobs gate staging, which gates production. Replace pre-push review/check requirements with force-push/deletion protection and owner-only write access. Keep both deployment flags off until the separate live staging and production bootstrap work is complete.

**Tech Stack:** GitHub Actions, GitHub branch protection REST API, Node.js 24, Bun 1.4.2, Vitest, Cloudflare Workers, Neon PostgreSQL.

**Spec:** `docs/superpowers/specs/2026-09-26-automatic-worker-release-design.md` (direct-main revision committed as `7836f22`). This plan supersedes only the PR/reviewer/source-gate clauses of `docs/superpowers/plans/2026-09-26-automatic-worker-release.md`.

## Global Constraints

- No hosted CI on a feature branch, required PR, independent reviewer, or manual merge; the owner pushes a fast-forward candidate to `main` without `--force`.
- Run applicable focused local checks while editing, but hosted CI/PostgreSQL validation runs once on the pushed `main` SHA before any maintenance, migration, or deployment.
- Protect `main` against force-push and deletion without requiring pre-push status checks or PR reviews; stage and production secrets remain main-only.
- Every app deployment closes whole-site admission and drains leases; deploy only affected Worker(s). Docs-only changes do not deploy or enter maintenance.
- Never enable `STAGING_RELEASE_ENABLED` or `PRODUCTION_RELEASE_ENABLED` in this plan. Current staging and test branches lack migration `0011`; production Workers/Hyperdrive and recovery rehearsal are not complete.
- No secrets or connection strings in Git, command output, evidence, or chat; do not modify live Neon/Cloudflare resources in this source-policy change.

## Review Focus

1. A branch or PR event must not obtain release credentials or trigger hosted CI; Task 1 asserts the sole workflow's trigger is `push: main`.
2. A `main` push must not run the full CI suite twice; Task 1 asserts no second workflow remains with a `main` push CI path.
3. Failed same-SHA CI or PostgreSQL jobs must prevent staging and therefore production; Task 1 preserves and tests `needs: [ci, postgres]` and `needs: [staging]`.
4. Zero reviewers and zero pre-push required checks must be accepted, while an unprotected or non-owner-writable source is rejected; Task 2 tests the revised bootstrap preflight.
5. A protection payload allowing force-push, branch deletion, required PR, or pre-push checks must fail policy tests; Task 2 checks the exact committed JSON payload.

---

## File map

- `.github/workflows/release.yml` remains the single push-to-`main` coordinator; remove redundant `.github/workflows/ci.yml`.
- `scripts/release-workflow.test.mjs` statically guards unique `main` CI, job dependency order, no branch/PR triggers, and flag isolation.
- `.github/main-protection.json` stores the non-secret, direct-push-compatible GitHub branch protection payload.
- `scripts/bootstrap-preflight.mjs` and its test accept that source policy but continue checking provider, secret-name, and recovery metadata.
- `AGENTS.md`, `PROJECT_CONTEXT.md`, `docs/DECISIONS.md`, `docs/DEPLOYMENT.md`, `docs/OPEN_QUESTIONS.md`, `docs/PROGRESS.md`, and the prior release plan record the superseded PR/reviewer requirement and the new operator flow.

### Task 1: One hosted CI path on the `main` push

**Files:** Modify `scripts/release-workflow.test.mjs`; delete `.github/workflows/ci.yml`. Retain `.github/workflows/release.yml` unless a test reveals a concrete gap.

**Interfaces:** The release workflow remains `push: main` with jobs `ci`, `postgres`, `staging`, `production`. `staging.needs = [ci, postgres]`; `production.needs = [staging]`. Neither deployment job may run without its existing environment flag and exact-SHA guards.

- [ ] **Step 1: Write failing static tests.** Read `.github/workflows/*.yml`; assert exactly one workflow can run on a `main` push, no workflow has `pull_request`/feature-branch release triggers, and the sole workflow retains CI/PostgreSQL job order, main-only environments, flag checks, and no direct Wrangler deployment outside the guarded CLI. Remove the old test that treats `CODEOWNERS` as required approval.
- [ ] **Step 2: Run `npm test -- scripts/release-workflow.test.mjs`.** Expect failure because `ci.yml` is still a second `main` push pipeline.
- [ ] **Step 3: Remove `.github/workflows/ci.yml` with an exact-target patch.** Do not remove `ci` or `postgres` from `release.yml`; these run even while release flags are false.
- [ ] **Step 4: Re-run the focused test.** Expect pass, including no branch or PR hosted CI.
- [ ] **Step 5: Commit** `scripts/release-workflow.test.mjs` and the workflow removal as `chore(ops): run CI once on main release workflow`.

### Task 2: Direct-push-compatible protected-source preflight

**Files:** Create `.github/main-protection.json`; modify `scripts/bootstrap-preflight.mjs` and `scripts/bootstrap-preflight.test.mjs`.

**Interfaces:** `checkBootstrapReadiness(input)` keeps `{ ready: boolean, issues: string[] }`. Its `github` metadata requires `mainProtected: true`, `requiresPullRequest: false`, `requiredChecks: []`, `forcePushAllowed: false`, `deletionAllowed: false`, `ownerOnlyWriteAccess: true`, both main-only environments with zero deployment reviewers, and `cloudflareGitDeployEnabled: false`. It no longer consumes `requiredApprovals`, `independentReviewerAvailable`, or `codeOwnerReviewRequired`. The JSON payload for GitHub's branch-protection PUT uses `required_status_checks: null`, `required_pull_request_reviews: null`, `enforce_admins: true`, `restrictions: null`, `required_linear_history: false`, `allow_force_pushes: false`, `allow_deletions: false`, `block_creations: false`, `required_conversation_resolution: false`, `lock_branch: false`, and `allow_fork_syncing: false`.

- [ ] **Step 1: Write failing tests.** A valid metadata fixture has no PR/reviewer/check requirement; setting any of `mainProtected: false`, `requiresPullRequest: true`, a nonempty `requiredChecks`, `forcePushAllowed: true`, `deletionAllowed: true`, or `ownerOnlyWriteAccess: false` yields `ready: false`. Read the JSON payload and assert null PR/status requirements and false force/deletion permissions. Retain secret-redaction and provider-target tests.
- [ ] **Step 2: Run `npm test -- scripts/bootstrap-preflight.test.mjs`.** Expect failure on the old reviewer gate and absent payload.
- [ ] **Step 3: Implement the new metadata predicate and exact JSON payload.** Keep other preflight checks unchanged; do not make any GitHub API write in this task.
- [ ] **Step 4: Run the focused test and `npm run lint`.** Both pass, with no credential value in diagnostics.
- [ ] **Step 5: Commit** the three files as `feat(ops): guard direct-push source policy`.

### Task 3: Make the permanent rules and operator runbook consistent

**Files:** Modify `AGENTS.md`, `PROJECT_CONTEXT.md`, `docs/DECISIONS.md`, `docs/DEPLOYMENT.md`, `docs/OPEN_QUESTIONS.md`, `docs/PROGRESS.md`, and the superseded clauses in `docs/superpowers/plans/2026-09-26-automatic-worker-release.md`.

**Interfaces:** ADR-028 records no PR/reviewer, no branch CI, one post-push exact-SHA CI gate, and unchanged staging/maintenance/production safety gates. The runbook uses `git fetch origin main`, `git merge-base --is-ancestor origin/main HEAD`, a clean worktree, and `git push origin HEAD:main` without `--force`. If `main` advanced or a check failed, stop and create a new commit/resolve ancestry; do not rewrite published `main`.

- [ ] **Step 1: Add ADR-028 and update the locked release rules.** Replace only mandatory PR/reviewer language; preserve Worker/VPS parity, whole-site maintenance, selective deployments, exact-SHA staging, inbox waiver, and destructive-data approval.
- [ ] **Step 2: Update deployment and project status docs.** State that failed post-push CI leaves the commit on `main` but makes no deployment, `CODEOWNERS` is informational only, both release flags remain off, and the fixed test branch is one migration behind.
- [ ] **Step 3: Mark the old release plan's PR/reviewer steps superseded by this plan.** Do not silently rewrite completed historical work or claim live staging/prod acceptance.
- [ ] **Step 4: Run `git diff --check`, `npm run format:check`, and search for contradictory mandatory PR/reviewer requirements in current rules.** Expect clean formatting and no active contradictory gate.
- [ ] **Step 5: Commit** the documentation/rules files as `docs(ops): adopt direct-main release policy`.

### Task 4: Verify locally, protect `main`, and push without deploying

**Files:** No new code files. External target: GitHub repository `akephisit/lovechapter`, branch `main`. Do not modify Neon, Cloudflare, Resend, or GitHub environments/secrets in this task.

**Interfaces:** The push candidate is the exact clean worktree `HEAD`; `origin/main` must be its ancestor. Both repository release flags remain absent/false. A successful branch-protection readback must show no required PR/checks, admin enforcement, and force-push/deletion disabled before pushing. A single `Worker release` run then checks the pushed SHA; staging and production remain skipped.

- [ ] **Step 1: Run applicable local validation without a branch-hosted CI run.** `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, and `npm exec --yes --package=bun@1.4.2 -- npm run build` must pass; inspect `git status --short` and revert only known build-generated `apps/web/next-env.d.ts` changes with an exact patch. The main-push GitHub workflow remains the single hosted CI gate.
- [ ] **Step 2: Audit GitHub metadata read-only.** Check repo/branch SHA, write-capable collaborators, absence of release-enabled flags, and existing protection. If an unexpected writer/flag/rule exists, stop and reconcile before any GitHub write.
- [ ] **Step 3: Apply the committed branch-protection payload** with `gh api --method PUT repos/akephisit/lovechapter/branches/main/protection --input .github/main-protection.json`; read it back and verify every source-policy field. If GitHub rejects it, do not bypass or push.
- [ ] **Step 4: Fetch and fast-forward push.** Run `git fetch origin main`, `git merge-base --is-ancestor origin/main HEAD`, and `git status --porcelain`; require ancestor success and empty status, then `git push origin HEAD:main` with no force. If remote `main` advanced, stop rather than rewriting it.
- [ ] **Step 5: Observe the hosted `Worker release` run for that exact SHA.** CI/PostgreSQL must pass once; staging/production must be skipped while flags are false. If CI fails, do not enable release or claim success; fix with a later forward commit. Report the run ID, SHA, and any unresolved live-staging/bootstrap blockers.

## Execution handoff

The owner chose native, task-by-task implementation. After this plan is reviewed, use `superpowers:executing-plans`; do not dispatch subagents. The live staging rehearsal, isolated Neon test-branch lifecycle, and production bootstrap remain governed by the original release plan and are not authorized by this source-policy update.
