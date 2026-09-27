import { existsSync, readFileSync } from "node:fs";
import { URL } from "node:url";

import { describe, expect, it } from "vitest";

import { checkBootstrapReadiness } from "./bootstrap-preflight.mjs";

const releaseSecrets = [
  "RELEASE_DATABASE_URL",
  "RELEASE_MIGRATION_DATABASE_URL",
  "RELEASE_NEON_API_KEY",
  "RELEASE_CLOUDFLARE_API_TOKEN",
  "WEB_PROXY_SHARED_SECRET",
  "RELEASE_PROBE_SECRET",
];
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
        production: { mainOnly: true, requiredReviewers: 0 },
      },
      cloudflareGitDeployEnabled: false,
    },
    neon: {
      projectId: "icy-hat-79862899",
      productionBranchId: "br-production-456",
      productionHost: "ep-production.neon.tech",
    },
    cloudflare: {
      accountId: "cf-account-123",
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
    secretsMetadata: { production: releaseSecrets },
    productionGate: { mode: "maintenance", firstPublication: true },
  };
}

describe("read-only first-production bootstrap preflight", () => {
  it("accepts a complete production-only target with no staging or rehearsal branch", () => {
    expect(checkBootstrapReadiness(ready())).toEqual({
      ready: true,
      issues: [],
    });
  });

  it("requires protected direct-main source and production-only environment scope", () => {
    for (const change of [
      (input) => (input.github.mainProtected = false),
      (input) => (input.github.requiredChecks = ["Verify"]),
      (input) => (input.github.forcePushAllowed = true),
      (input) => (input.github.environments.production.mainOnly = false),
      (input) => (input.github.cloudflareGitDeployEnabled = true),
    ]) {
      const input = ready();
      change(input);
      expect(checkBootstrapReadiness(input).ready).toBe(false);
    }
  });

  it("keeps the expected owner-only branch protection policy", () => {
    const path = new URL("../.github/main-protection.json", import.meta.url);
    expect(existsSync(path)).toBe(true);
    const payload = JSON.parse(readFileSync(path, "utf8"));
    expect(payload.allow_force_pushes).toBe(false);
    expect(payload.allow_deletions).toBe(false);
    expect(payload.required_pull_request_reviews).toBeNull();
    expect(payload.required_status_checks).toBeNull();
  });

  it("requires the exact production Neon/Hyperdrive pair and closed gate", () => {
    for (const change of [
      (input) => (input.neon.productionBranchId = ""),
      (input) => (input.neon.productionHost = "ep-production-pooler.neon.tech"),
      (input) =>
        (input.cloudflare.production.hyperdriveHost = "ep-other.neon.tech"),
      (input) => (input.cloudflare.production.cacheDisabled = false),
      (input) => (input.cloudflare.production.previewUrlsDisabled = false),
      (input) => (input.productionGate.mode = "open"),
    ]) {
      const input = ready();
      change(input);
      expect(checkBootstrapReadiness(input).ready).toBe(false);
    }
  });

  it("requires only production secret names and never returns values", () => {
    const input = ready();
    input.secretsMetadata.production = [
      { name: "RELEASE_DATABASE_URL", value: "private-password" },
    ];
    const result = checkBootstrapReadiness(input);
    expect(result.ready).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private-password");
  });
});
