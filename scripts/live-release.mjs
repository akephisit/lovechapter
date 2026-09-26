import { createGitHubReadClient } from "./github-release-client.mjs";
import { createReleaseDriver } from "./release-driver.mjs";
import { executeRelease } from "./release-execution.mjs";
import { createReleaseGateCommand } from "./release-gate-command.mjs";
import { createReleaseMigrationCommand } from "./release-migration-command.mjs";
import { canonicalSecret } from "./release-smoke.mjs";
import {
  createStagingAcceptanceCommand,
  createStagingAcceptancePreflightCommand,
} from "./staging-acceptance-command.mjs";
import { writeStagingOutput } from "./staging-output.mjs";
import { createWorkerCommandRunner } from "./worker-versions.mjs";

const shaPattern = /^[0-9a-f]{40}$/u;
const requiredStaging = [
  "GITHUB_OUTPUT",
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
  "RELEASE_TEST_EMAIL",
  "RELEASE_TEST_PASSWORD",
  "RELEASE_VERIFICATION_EMAIL",
  "RELEASE_FOREIGN_WEDDING_ID",
  "RELEASE_TEST_DATABASE_URL",
  "RELEASE_TEST_MIGRATION_DATABASE_URL",
  "RELEASE_TEST_MIGRATION_DATABASE_ROLE",
  "RELEASE_TEST_BRANCH_ID",
];

/** The staging-only live coordinator remains behind protected-main and flags. */
export async function runLiveRelease(
  { environment, sha },
  env,
  {
    makeGate = createReleaseGateCommand,
    makeWorkerRunner = createWorkerCommandRunner,
    makeGitHubRead = createGitHubReadClient,
    makeMigration = createReleaseMigrationCommand,
    makePreflight = createStagingAcceptancePreflightCommand,
    makeAcceptance = createStagingAcceptanceCommand,
    makeReleaseDriver = createReleaseDriver,
    execute = executeRelease,
    writeOutput = writeStagingOutput,
  } = {},
) {
  if (environment !== "staging") {
    throw new Error("Production release bootstrap is not complete");
  }
  if (
    !shaPattern.test(sha ?? "") ||
    env?.RELEASE_ENVIRONMENT !== "staging" ||
    env.RELEASE_POSTGRES_JOB_RESULT !== "success" ||
    env.RELEASE_TEST_DATABASE_CONFIRM !== "lovechapter_test" ||
    requiredStaging.some(
      (name) =>
        typeof env[name] !== "string" ||
        !env[name].trim() ||
        env[name].startsWith("REPLACE_WITH_"),
    ) ||
    !canonicalSecret(env.WEB_PROXY_SHARED_SECRET) ||
    !canonicalSecret(env.RELEASE_PROBE_SECRET) ||
    env.WEB_PROXY_SHARED_SECRET === env.RELEASE_PROBE_SECRET
  ) {
    throw new Error("Staging release configuration is incomplete");
  }
  const gate = makeGate({ env });
  const workerRunner = makeWorkerRunner({
    cloudflareAccountId: env.RELEASE_CLOUDFLARE_ACCOUNT_ID,
    cloudflareApiToken: env.RELEASE_CLOUDFLARE_API_TOKEN,
  });
  const githubRead = makeGitHubRead({ token: env.GITHUB_TOKEN });
  const migration = makeMigration({ env });
  const preflight = makePreflight({ env });
  const acceptance = makeAcceptance({ env });
  const result = await execute(
    { environment, sha },
    {
      gate,
      createDriver: ({ impact, previous }) =>
        makeReleaseDriver({
          environment,
          sha,
          impact,
          previous,
          hyperdriveId: env.RELEASE_HYPERDRIVE_ID,
          workerRunner,
          gate,
          githubRead,
          webOrigin: env.RELEASE_WEB_ORIGIN,
          apiOrigin: env.RELEASE_API_ORIGIN,
          proxySecret: env.WEB_PROXY_SHARED_SECRET,
          probeSecret: env.RELEASE_PROBE_SECRET,
          verifyStaging: preflight,
          applyMigration: migration,
          acceptStaging: acceptance,
        }),
    },
  );
  if (result?.status === "released") {
    await writeOutput(result, env.GITHUB_OUTPUT);
  }
  return result;
}
