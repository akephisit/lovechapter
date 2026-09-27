const releaseSecrets = [
  "RELEASE_DATABASE_URL",
  "RELEASE_MIGRATION_DATABASE_URL",
  "RELEASE_NEON_API_KEY",
  "RELEASE_CLOUDFLARE_API_TOKEN",
  "WEB_PROXY_SHARED_SECRET",
  "RELEASE_PROBE_SECRET",
];
const webWorkerSecrets = [
  "API_UPSTREAM_ORIGIN",
  "WEB_PROXY_SHARED_SECRET",
  "RELEASE_PROBE_SECRET",
];
const apiWorkerSecrets = [
  "AUTH_TOKEN_ACTIVE_KEY_VERSION",
  "AUTH_TOKEN_HMAC_KEYS",
  "PUBLIC_WEB_ORIGIN",
  "RATE_LIMIT_HMAC_KEY",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "WEB_PROXY_SHARED_SECRET",
];

function configured(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    !value.startsWith("REPLACE_WITH_")
  );
}

function namesContain(names, required) {
  return (
    Array.isArray(names) &&
    names.every((name) => typeof name === "string") &&
    required.every((name) => names.includes(name))
  );
}

function safeHost(value) {
  return (
    configured(value) &&
    value.endsWith(".neon.tech") &&
    !/(?:^|[-.])(?:pooler|pgbouncer)(?:[.-]|$)/iu.test(value)
  );
}

/** Metadata-only audit; never inspect or return a secret value. */
export function checkBootstrapReadiness(input) {
  const issues = [];
  const github = input?.github;
  if (
    github?.mainProtected !== true ||
    github.requiresPullRequest !== false ||
    !Array.isArray(github.requiredChecks) ||
    github.requiredChecks.length !== 0 ||
    github.forcePushAllowed !== false ||
    github.deletionAllowed !== false ||
    github.ownerOnlyWriteAccess !== true
  ) {
    issues.push("protected_source_incomplete");
  }
  const productionEnvironment = github?.environments?.production;
  if (
    productionEnvironment?.mainOnly !== true ||
    productionEnvironment.requiredReviewers !== 0
  ) {
    issues.push("production_environment_unrestricted");
  }
  if (github?.cloudflareGitDeployEnabled !== false) {
    issues.push("independent_cloudflare_deploy_not_disabled");
  }

  const neon = input?.neon;
  if (
    !configured(neon?.projectId) ||
    !configured(neon?.productionBranchId) ||
    !neon.productionBranchId.startsWith("br-") ||
    !safeHost(neon?.productionHost)
  ) {
    issues.push("neon_branch_identity_incomplete");
  }

  const cloudflare = input?.cloudflare;
  if (!configured(cloudflare?.accountId)) {
    issues.push("cloudflare_account_unverified");
  }
  if (!configured(cloudflare?.production?.hyperdriveId)) {
    issues.push("hyperdrive_identity_incomplete");
  }
  const target = cloudflare?.production;
  if (
    target?.webName !== "lovechapter-web" ||
    target.apiName !== "lovechapter-api" ||
    target.hyperdriveHost !== neon?.productionHost ||
    target.cacheDisabled !== true ||
    target.previewUrlsDisabled !== true ||
    !namesContain(target.webSecretNames, webWorkerSecrets) ||
    !namesContain(target.apiSecretNames, apiWorkerSecrets)
  ) {
    issues.push("production_worker_target_incomplete");
  }
  if (!namesContain(input?.secretsMetadata?.production, releaseSecrets)) {
    issues.push("production_release_secrets_missing");
  }
  if (
    input?.productionGate?.mode !== "maintenance" ||
    input.productionGate.firstPublication !== true
  ) {
    issues.push("production_gate_not_closed_before_publication");
  }
  return { ready: issues.length === 0, issues };
}
