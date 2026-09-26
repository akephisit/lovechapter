import { existsSync, readFileSync } from "node:fs";
import { URL } from "node:url";

import { describe, expect, it } from "vitest";

import { checkBootstrapReadiness } from "./bootstrap-preflight.mjs";

const stagingSecrets = [
  "RELEASE_DATABASE_URL",
  "RELEASE_MIGRATION_DATABASE_URL",
  "RELEASE_NEON_API_KEY",
  "RELEASE_CLOUDFLARE_API_TOKEN",
  "WEB_PROXY_SHARED_SECRET",
  "RELEASE_PROBE_SECRET",
  "RELEASE_TEST_EMAIL",
  "RELEASE_TEST_PASSWORD",
  "RELEASE_VERIFICATION_EMAIL",
  "RELEASE_TEST_DATABASE_URL",
  "RELEASE_TEST_MIGRATION_DATABASE_URL",
];
const productionSecrets = stagingSecrets.slice(0, 6);
const webSecrets = [
  "API_UPSTREAM_ORIGIN",
  "WEB_PROXY_SHARED_SECRET",
  "RELEASE_PROBE_SECRET",
];
const apiSecrets = [
  "AUTH_TOKEN_ACTIVE_KEY_VERSION",
  "AUTH_TOKEN_HMAC_KEYS",
  "PUBLIC_WEB_ORIGIN",
  "RATE_LIMIT_HMAC_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "WEB_PROXY_SHARED_SECRET",
];

function ready() {
  return {
    github: {
      mainProtected: true,
      requiresPullRequest: false,
      requiredChecks: [],
      forcePushAllowed: false,
      deletionAllowed: false,
      ownerOnlyWriteAccess: true,
      environments: {
        staging: { mainOnly: true, requiredReviewers: 0 },
        production: { mainOnly: true, requiredReviewers: 0 },
      },
      cloudflareGitDeployEnabled: false,
    },
    neon: {
      projectId: "icy-hat-79862899",
      stagingBranchId: "br-staging-123",
      productionBranchId: "br-production-456",
      stagingHost: "ep-staging.neon.tech",
      productionHost: "ep-production.neon.tech",
      testBranchId: "br-test-789",
      testHost: "ep-test.neon.tech",
    },
    cloudflare: {
      accountId: "cf-account-123",
      staging: {
        webName: "lovechapter-web-staging",
        apiName: "lovechapter-api-staging",
        hyperdriveId: "staging-hyperdrive-123",
        hyperdriveHost: "ep-staging.neon.tech",
        cacheDisabled: true,
        previewUrlsDisabled: true,
        webSecretNames: webSecrets,
        apiSecretNames: apiSecrets,
      },
      production: {
        webName: "lovechapter-web",
        apiName: "lovechapter-api",
        hyperdriveId: "production-hyperdrive-456",
        hyperdriveHost: "ep-production.neon.tech",
        cacheDisabled: true,
        previewUrlsDisabled: true,
        webSecretNames: webSecrets,
        apiSecretNames: apiSecrets,
      },
    },
    secretsMetadata: { staging: stagingSecrets, production: productionSecrets },
    recoveryEvidence: {
      branchId: "br-restore-987",
      retainedDataVerified: true,
      checkpointLsn: "0/1234ABCD",
    },
    productionGate: { mode: "maintenance", firstPublication: true },
  };
}

describe("read-only production bootstrap preflight", () => {
  it("accepts only exact protected source and isolated targets", () => {
    expect(checkBootstrapReadiness(ready())).toEqual({
      ready: true,
      issues: [],
    });
  });

  it("fails on missing direct-push source protection", () => {
    for (const edit of [
      { mainProtected: false },
      { requiredChecks: ["Verify"] },
      { requiresPullRequest: true },
      { forcePushAllowed: true },
      { deletionAllowed: true },
      { ownerOnlyWriteAccess: false },
      { cloudflareGitDeployEnabled: true },
    ]) {
      const input = ready();
      Object.assign(input.github, edit);
      expect(checkBootstrapReadiness(input).ready).toBe(false);
    }
  });

  it("stores only a non-bypass direct-push branch-protection payload", () => {
    const path = new URL("../.github/main-protection.json", import.meta.url);
    expect(existsSync(path)).toBe(true);
    const payload = JSON.parse(readFileSync(path, "utf8"));
    expect(payload).toEqual({
      required_status_checks: null,
      enforce_admins: true,
      required_pull_request_reviews: null,
      restrictions: null,
      required_linear_history: false,
      allow_force_pushes: false,
      allow_deletions: false,
      block_creations: false,
      required_conversation_resolution: false,
      lock_branch: false,
      allow_fork_syncing: false,
    });
  });

  it("fails on unsafe GitHub environments, Neon target, or Hyperdrive", () => {
    for (const change of [
      (input) => (input.github.environments.production.mainOnly = false),
      (input) => (input.github.environments.staging.requiredReviewers = 1),
      (input) => (input.neon.productionBranchId = input.neon.stagingBranchId),
      (input) => (input.neon.testHost = input.neon.productionHost),
      (input) =>
        (input.cloudflare.production.hyperdriveId =
          "REPLACE_WITH_HYPERDRIVE_ID"),
      (input) =>
        (input.cloudflare.production.hyperdriveHost = input.neon.stagingHost),
      (input) => (input.cloudflare.production.cacheDisabled = false),
      (input) => (input.cloudflare.production.previewUrlsDisabled = false),
    ]) {
      const input = ready();
      change(input);
      expect(checkBootstrapReadiness(input).ready).toBe(false);
    }
  });

  it("fails on missing secret names, recovery, or a premature open production gate", () => {
    for (const change of [
      (input) => (input.secretsMetadata.staging = []),
      (input) =>
        (input.cloudflare.staging.webSecretNames = [
          "WEB_PROXY_SHARED_SECRET",
          "RELEASE_PROBE_SECRET",
        ]),
      (input) => (input.cloudflare.production.apiSecretNames = []),
      (input) => (input.recoveryEvidence.retainedDataVerified = false),
      (input) => (input.productionGate.mode = "open"),
    ]) {
      const input = ready();
      change(input);
      expect(checkBootstrapReadiness(input).ready).toBe(false);
    }
  });

  it("never reflects credential values in diagnostics", () => {
    const input = ready();
    input.secretsMetadata.staging = [
      { name: "RELEASE_DATABASE_URL", value: "private-password" },
    ];
    const result = checkBootstrapReadiness(input);
    expect(result.ready).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private-password");
  });
});
