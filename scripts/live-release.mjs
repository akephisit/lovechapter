import { createGitHubDeploymentClient } from "./github-deployments.mjs";
import { createGitHubReadClient } from "./github-release-client.mjs";
import { createNeonRecoveryPoint } from "./neon-recovery-point.mjs";
import { createReleaseDriver } from "./release-driver.mjs";
import { executeRelease } from "./release-execution.mjs";
import { createReleaseGateCommand } from "./release-gate-command.mjs";
import { createReleaseMigrationCommand } from "./release-migration-command.mjs";
import { canonicalSecret } from "./release-smoke.mjs";
import { createWorkerCommandRunner } from "./worker-versions.mjs";

const shaPattern = /^[0-9a-f]{40}$/u;
const requiredProduction = [
  "GITHUB_TOKEN",
  "RELEASE_NEON_PROJECT_ID",
  "RELEASE_NEON_BRANCH_ID",
  "RELEASE_DATABASE_NAME",
  "RELEASE_DATABASE_ROLE",
  "RELEASE_APP_DATABASE_ROLE",
  "RELEASE_MIGRATION_DATABASE_ROLE",
  "RELEASE_CLOUDFLARE_ACCOUNT_ID",
  "RELEASE_HYPERDRIVE_ID",
  "RELEASE_WEB_ORIGIN",
  "RELEASE_API_ORIGIN",
  "RELEASE_DATABASE_URL",
  "RELEASE_MIGRATION_DATABASE_URL",
  "RELEASE_NEON_API_KEY",
  "RELEASE_CLOUDFLARE_API_TOKEN",
];

function configured(value) {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    !value.startsWith("REPLACE_WITH_")
  );
}

/** Compose one direct production release after exact-main context checks. */
export async function runLiveRelease(
  { environment, sha },
  env,
  {
    makeGate = createReleaseGateCommand,
    makeWorkerRunner = createWorkerCommandRunner,
    makeGitHubRead = createGitHubReadClient,
    makeGitHubDeployment = createGitHubDeploymentClient,
    makeMigration = createReleaseMigrationCommand,
    makeRecoveryPoint = createNeonRecoveryPoint,
    makeReleaseDriver = createReleaseDriver,
    execute = executeRelease,
  } = {},
) {
  if (
    environment !== "production" ||
    !shaPattern.test(sha ?? "") ||
    env?.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_EVENT_NAME !== "push" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_REF_PROTECTED !== "true" ||
    env.GITHUB_REPOSITORY !== "akephisit/lovechapter" ||
    env.GITHUB_SHA !== sha ||
    env.RELEASE_ENVIRONMENT !== "production" ||
    env.PRODUCTION_RELEASE_ENABLED !== "true" ||
    env.RELEASE_POSTGRES_JOB_RESULT !== "success" ||
    requiredProduction.some((name) => !configured(env[name])) ||
    !canonicalSecret(env.WEB_PROXY_SHARED_SECRET) ||
    !canonicalSecret(env.RELEASE_PROBE_SECRET) ||
    env.WEB_PROXY_SHARED_SECRET === env.RELEASE_PROBE_SECRET
  ) {
    throw new Error("Production release configuration is incomplete");
  }

  const githubRead = makeGitHubRead({ token: env.GITHUB_TOKEN });
  if ((await githubRead.readMainHead()) !== sha) {
    throw new Error("Release SHA was superseded on main");
  }
  const githubDeployment = makeGitHubDeployment({ token: env.GITHUB_TOKEN });
  const gate = makeGate({ env });
  const workerRunner = makeWorkerRunner({
    cloudflareAccountId: env.RELEASE_CLOUDFLARE_ACCOUNT_ID,
    cloudflareApiToken: env.RELEASE_CLOUDFLARE_API_TOKEN,
  });
  const migration = makeMigration({ env });
  return execute(
    { environment, sha },
    {
      gate,
      ledger: githubDeployment,
      createDriver: ({ impact, previous, baselineSha }) =>
        makeReleaseDriver({
          environment,
          sha,
          impact,
          previous,
          hyperdriveId: env.RELEASE_HYPERDRIVE_ID,
          workerRunner,
          gate,
          githubRead,
          githubDeployment,
          webOrigin: env.RELEASE_WEB_ORIGIN,
          apiOrigin: env.RELEASE_API_ORIGIN,
          proxySecret: env.WEB_PROXY_SHARED_SECRET,
          probeSecret: env.RELEASE_PROBE_SECRET,
          verifyProduction: async () => ({
            releaseEnabled: true,
            protectedMain: true,
            targetVerified: true,
            baseline: {
              expectedSha: baselineSha,
              currentSha: (await gate.status()).targetSha,
            },
          }),
          applyMigration: migration,
          createRecoveryPoint: async (candidate, { closure }) =>
            makeRecoveryPoint({
              projectId: env.RELEASE_NEON_PROJECT_ID,
              branchId: env.RELEASE_NEON_BRANCH_ID,
              sha: candidate,
              closedAt: closure.changedAt,
              apiKey: env.RELEASE_NEON_API_KEY,
            }),
        }),
    },
  );
}
