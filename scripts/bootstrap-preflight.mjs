const requiredChecks = ["Verify", "PostgreSQL integration"];
const sharedSecrets = [
  "RELEASE_DATABASE_URL",
  "RELEASE_MIGRATION_DATABASE_URL",
  "RELEASE_NEON_API_KEY",
  "RELEASE_CLOUDFLARE_API_TOKEN",
  "WEB_PROXY_SHARED_SECRET",
  "RELEASE_PROBE_SECRET",
];
const stagingSecrets = [
  ...sharedSecrets,
  "RELEASE_TEST_EMAIL",
  "RELEASE_TEST_PASSWORD",
  "RELEASE_VERIFICATION_EMAIL",
  "RELEASE_TEST_DATABASE_URL",
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

function distinct(...values) {
  return values.every(configured) && new Set(values).size === values.length;
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
    !namesContain(github.requiredChecks, requiredChecks) ||
    !Number.isInteger(github.requiredApprovals) ||
    github.requiredApprovals < 1 ||
    github.independentReviewerAvailable !== true ||
    github.codeOwnerReviewRequired !== true
  ) {
    issues.push("protected_source_incomplete");
  }
  for (const name of ["staging", "production"]) {
    const environment = github?.environments?.[name];
    if (environment?.mainOnly !== true || environment.requiredReviewers !== 0) {
      issues.push(`${name}_environment_unrestricted`);
    }
  }
  if (github?.cloudflareGitDeployEnabled !== false) {
    issues.push("independent_cloudflare_deploy_not_disabled");
  }

  const neon = input?.neon;
  if (
    !configured(neon?.projectId) ||
    !distinct(
      neon?.stagingBranchId,
      neon?.productionBranchId,
      neon?.testBranchId,
    ) ||
    ![
      neon?.stagingBranchId,
      neon?.productionBranchId,
      neon?.testBranchId,
    ].every((value) => value?.startsWith("br-")) ||
    !distinct(neon?.stagingHost, neon?.productionHost, neon?.testHost) ||
    ![neon?.stagingHost, neon?.productionHost, neon?.testHost].every(safeHost)
  ) {
    issues.push("neon_branch_identity_incomplete");
  }

  const cloudflare = input?.cloudflare;
  if (!configured(cloudflare?.accountId)) {
    issues.push("cloudflare_account_unverified");
  }
  if (
    !distinct(
      cloudflare?.staging?.hyperdriveId,
      cloudflare?.production?.hyperdriveId,
    )
  ) {
    issues.push("hyperdrive_identity_incomplete");
  }
  for (const name of ["staging", "production"]) {
    const target = cloudflare?.[name];
    const suffix = name === "staging" ? "-staging" : "";
    if (
      target?.webName !== `lovechapter-web${suffix}` ||
      target.apiName !== `lovechapter-api${suffix}` ||
      target.hyperdriveHost !== neon?.[`${name}Host`] ||
      target.cacheDisabled !== true ||
      target.previewUrlsDisabled !== true ||
      !namesContain(target.webSecretNames, webWorkerSecrets) ||
      !namesContain(target.apiSecretNames, apiWorkerSecrets)
    ) {
      issues.push(`${name}_worker_target_incomplete`);
    }
    if (
      !namesContain(
        input?.secretsMetadata?.[name],
        name === "staging" ? stagingSecrets : sharedSecrets,
      )
    ) {
      issues.push(`${name}_release_secrets_missing`);
    }
  }

  const recovery = input?.recoveryEvidence;
  if (
    !configured(recovery?.branchId) ||
    [
      neon?.stagingBranchId,
      neon?.productionBranchId,
      neon?.testBranchId,
    ].includes(recovery.branchId) ||
    recovery.retainedDataVerified !== true ||
    !/^[0-9A-F]+\/[0-9A-F]+$/iu.test(recovery.checkpointLsn ?? "")
  ) {
    issues.push("isolated_recovery_rehearsal_missing");
  }
  if (
    input?.productionGate?.mode !== "maintenance" ||
    input.productionGate.firstPublication !== true
  ) {
    issues.push("production_gate_not_closed_before_publication");
  }
  return { ready: issues.length === 0, issues };
}
