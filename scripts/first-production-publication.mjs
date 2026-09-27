import console from "node:console";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL, URL } from "node:url";

import { readMigrationFiles } from "drizzle-orm/migrator";
import pg from "pg";

import { recordDeployment } from "./deployment-ledger.mjs";
import { createGitHubDeploymentClient } from "./github-deployments.mjs";
import { createGitHubReadClient } from "./github-release-client.mjs";
import { buildReleaseEvidence } from "./release-evidence-builder.mjs";
import { createReleaseGateCommand } from "./release-gate-command.mjs";
import {
  canonicalSecret,
  runPrivateReleaseSmoke,
  runPublicReleaseCheck,
  workerOrigin,
} from "./release-smoke.mjs";
import {
  createWorkerCommandRunner,
  deployPreparedVersions,
  prepareWorkerVersions,
} from "./worker-versions.mjs";

const shaPattern = /^[0-9a-f]{40}$/u;
const versionPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const migrationFolder = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../packages/database/drizzle",
);
const required = [
  "GITHUB_TOKEN",
  "RELEASE_DATABASE_URL",
  "RELEASE_MIGRATION_DATABASE_URL",
  "RELEASE_MIGRATION_DATABASE_ROLE",
  "RELEASE_NEON_PROJECT_ID",
  "RELEASE_NEON_BRANCH_ID",
  "RELEASE_DATABASE_NAME",
  "RELEASE_DATABASE_ROLE",
  "RELEASE_APP_DATABASE_ROLE",
  "RELEASE_CLOUDFLARE_ACCOUNT_ID",
  "RELEASE_HYPERDRIVE_ID",
  "RELEASE_NEON_API_KEY",
  "RELEASE_CLOUDFLARE_API_TOKEN",
  "RELEASE_WEB_ORIGIN",
  "RELEASE_API_ORIGIN",
];

function configured(value) {
  return (
    typeof value === "string" &&
    value.trim() &&
    !value.startsWith("REPLACE_WITH_")
  );
}

function matchingMigrationTarget(env) {
  try {
    // Match the direct-URL restrictions in release-target.ts. pg accepts
    // query-string host overrides, so comparing URL.hostname alone is unsafe.
    function directUrl(value) {
      const url = new URL(value);
      const channelBindings = url.searchParams.getAll("channel_binding");
      if (
        !["postgres:", "postgresql:"].includes(url.protocol) ||
        !url.hostname ||
        !url.username ||
        !url.password ||
        (url.port !== "" && url.port !== "5432") ||
        /(?:^|[-.])(?:pooler|pgbouncer)(?:[.-]|$)/iu.test(url.hostname) ||
        [...url.searchParams.keys()].some(
          (name) => name !== "sslmode" && name !== "channel_binding",
        ) ||
        url.searchParams.getAll("sslmode").length !== 1 ||
        !["require", "verify-full"].includes(url.searchParams.get("sslmode")) ||
        channelBindings.length > 1 ||
        (channelBindings.length === 1 && channelBindings[0] !== "require") ||
        !/^\/[a-zA-Z0-9_%-]+$/u.test(url.pathname)
      ) {
        return null;
      }
      return url;
    }
    const gate = directUrl(env.RELEASE_DATABASE_URL);
    const migration = directUrl(env.RELEASE_MIGRATION_DATABASE_URL);
    return (
      gate &&
      migration &&
      gate.hostname === migration.hostname &&
      gate.port === migration.port &&
      gate.pathname === migration.pathname &&
      decodeURIComponent(gate.username) === env.RELEASE_DATABASE_ROLE &&
      decodeURIComponent(migration.username) ===
        env.RELEASE_MIGRATION_DATABASE_ROLE &&
      decodeURIComponent(gate.pathname.slice(1)) === env.RELEASE_DATABASE_NAME
    );
  } catch {
    return false;
  }
}

function assertContext(env) {
  if (
    env?.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_REF_PROTECTED !== "true" ||
    env.GITHUB_REPOSITORY !== "akephisit/lovechapter" ||
    !shaPattern.test(env.GITHUB_SHA ?? "") ||
    env.PRODUCTION_RELEASE_ENABLED !== "false" ||
    env.RELEASE_ENVIRONMENT !== "production" ||
    !shaPattern.test(env.BOOTSTRAP_PREVIOUS_SHA ?? "") ||
    env.BOOTSTRAP_PREVIOUS_SHA === env.GITHUB_SHA ||
    !versionPattern.test(env.BOOTSTRAP_PREVIOUS_WEB_VERSION_ID ?? "") ||
    !versionPattern.test(env.BOOTSTRAP_PREVIOUS_API_VERSION_ID ?? "") ||
    required.some((name) => !configured(env[name])) ||
    !matchingMigrationTarget(env) ||
    !canonicalSecret(env.WEB_PROXY_SHARED_SECRET) ||
    !canonicalSecret(env.RELEASE_PROBE_SECRET) ||
    env.WEB_PROXY_SHARED_SECRET === env.RELEASE_PROBE_SECRET ||
    !workerOrigin(env.RELEASE_WEB_ORIGIN) ||
    !workerOrigin(env.RELEASE_API_ORIGIN) ||
    env.RELEASE_WEB_ORIGIN === env.RELEASE_API_ORIGIN
  ) {
    throw new Error("First production publication context is invalid");
  }
}

async function withGateConnection(env, action) {
  const client = new pg.Client({
    connectionString: env.RELEASE_DATABASE_URL,
    connectionTimeoutMillis: 5_000,
    query_timeout: 10_000,
  });
  try {
    await client.connect();
    return await action(client);
  } finally {
    await client.end();
  }
}

/** The current schema must already be deployed; this publication runs no SQL migration. */
export async function assertBootstrapLedgerCurrent(
  env,
  connect = withGateConnection,
) {
  if (!matchingMigrationTarget(env)) {
    throw new Error("First publication migration target is invalid");
  }
  const journal = JSON.parse(
    readFileSync(resolve(migrationFolder, "meta/_journal.json"), "utf8"),
  );
  const files = readMigrationFiles({ migrationsFolder: migrationFolder });
  if (
    !Array.isArray(journal.entries) ||
    journal.entries.length === 0 ||
    journal.entries.length !== files.length ||
    journal.entries.length > 1000 ||
    journal.entries.some(
      (entry, index) =>
        !/^[A-Za-z0-9_-]+$/u.test(entry.tag ?? "") ||
        entry.when !== files[index]?.folderMillis,
    )
  ) {
    throw new Error("Checked-in migration history is invalid");
  }
  await connect(
    { ...env, RELEASE_DATABASE_URL: env.RELEASE_MIGRATION_DATABASE_URL },
    async (client) => {
      const ledger = await client.query(
        `select hash, created_at::text from drizzle.__drizzle_migrations
       order by created_at, id limit 1001`,
      );
      if (
        ledger.rows.length !== files.length ||
        ledger.rows.some(
          (row, index) =>
            row.hash !== files[index].hash ||
            Number(row.created_at) !== journal.entries[index].when,
        )
      ) {
        throw new Error("Production migration ledger is not current");
      }
    },
  );
}

/** Retarget only an unpublished, drained, unchanged closure. */
export async function retargetClosedBootstrap(
  old,
  sha,
  env,
  connect = withGateConnection,
) {
  if (
    old?.mode !== "maintenance" ||
    !shaPattern.test(old.targetSha ?? "") ||
    !shaPattern.test(sha ?? "") ||
    old.targetSha === sha ||
    old.activeCount !== 0 ||
    old.web !== null ||
    old.api !== null ||
    !Number.isFinite(Date.parse(old.changedAt ?? ""))
  ) {
    throw new Error("First publication gate is not unpublished and drained");
  }
  await connect(env, async (client) => {
    const result = await client.query(
      `update ops.release_control
       set target_sha = $2, changed_at = now()
       where id = 1 and mode = 'maintenance' and target_sha = $1
         and changed_at = $3::timestamptz
         and web_version_id is null and web_source_sha is null
         and api_version_id is null and api_source_sha is null
         and not exists (select 1 from ops.release_leases)
       returning id`,
      [old.targetSha, sha, old.changedAt],
    );
    if (result.rowCount !== 1) {
      throw new Error("First publication gate changed during retarget");
    }
  });
}

/** Temporary, manually dispatched bootstrap; normal releases use release-cli.mjs. */
export async function runFirstProductionPublication(env, adapters = {}) {
  assertContext(env);
  const sha = env.GITHUB_SHA;
  const previous = {
    web: {
      versionId: env.BOOTSTRAP_PREVIOUS_WEB_VERSION_ID,
      sourceSha: env.BOOTSTRAP_PREVIOUS_SHA,
    },
    api: {
      versionId: env.BOOTSTRAP_PREVIOUS_API_VERSION_ID,
      sourceSha: env.BOOTSTRAP_PREVIOUS_SHA,
    },
  };
  const impact = { web: true, backend: true, migrate: false };
  const githubRead =
    adapters.githubRead ?? createGitHubReadClient({ token: env.GITHUB_TOKEN });
  const githubDeployment =
    adapters.githubDeployment ??
    createGitHubDeploymentClient({ token: env.GITHUB_TOKEN });
  const gate = adapters.gate ?? createReleaseGateCommand({ env });
  const workerRunner =
    adapters.workerRunner ??
    createWorkerCommandRunner({
      cloudflareAccountId: env.RELEASE_CLOUDFLARE_ACCOUNT_ID,
      cloudflareApiToken: env.RELEASE_CLOUDFLARE_API_TOKEN,
    });
  const prepare = adapters.prepare ?? prepareWorkerVersions;
  const deploy = adapters.deploy ?? deployPreparedVersions;
  const assertLedgerCurrent =
    adapters.assertLedgerCurrent ?? assertBootstrapLedgerCurrent;
  const retarget = adapters.retarget ?? retargetClosedBootstrap;
  const privateSmoke = adapters.privateSmoke ?? runPrivateReleaseSmoke;
  const publicCheck = adapters.publicCheck ?? runPublicReleaseCheck;
  const record = adapters.record ?? recordDeployment;
  if ((await githubRead.readMainHead()) !== sha) {
    throw new Error("First publication SHA was superseded");
  }
  const old = await gate.status();
  if (
    old.mode !== "maintenance" ||
    old.targetSha !== env.BOOTSTRAP_PREVIOUS_SHA ||
    old.activeCount !== 0 ||
    old.web !== null ||
    old.api !== null
  ) {
    throw new Error("First publication gate baseline is invalid");
  }
  await assertLedgerCurrent(env);
  const prepared = await prepare(
    {
      environment: "production",
      impact,
      sha,
      previous,
      hyperdriveId: env.RELEASE_HYPERDRIVE_ID,
    },
    workerRunner,
  );
  if ((await githubRead.readMainHead()) !== sha) {
    throw new Error("First publication SHA was superseded after preparation");
  }
  await retarget(old, sha, env);
  const closure = await gate.drain(sha);
  if (
    closure.mode !== "maintenance" ||
    closure.targetSha !== sha ||
    closure.activeCount !== 0 ||
    closure.web !== null ||
    closure.api !== null
  ) {
    throw new Error("First publication gate did not drain at candidate SHA");
  }
  const deployed = await deploy(prepared, workerRunner);
  const smoke = await privateSmoke({
    sha,
    closure,
    deployed,
    webOrigin: env.RELEASE_WEB_ORIGIN,
    apiOrigin: env.RELEASE_API_ORIGIN,
    proxySecret: env.WEB_PROXY_SHARED_SECRET,
    probeSecret: env.RELEASE_PROBE_SECRET,
  });
  if ((await githubRead.readMainHead()) !== sha) {
    throw new Error("First publication SHA was superseded before reopen");
  }
  const evidence = buildReleaseEvidence({
    environment: "production",
    sha,
    impact,
    previous: null,
    deployed,
    closure,
    smoke,
    migrationOutcome: "not_required",
  });
  try {
    // Opening can commit before its status response is lost; reclose even if
    // the open call itself rejects.
    const opened = await gate.open(sha, evidence);
    if (
      opened?.mode !== "open" ||
      opened.targetSha !== sha ||
      opened.web?.versionId !== deployed.web.versionId ||
      opened.web?.sourceSha !== deployed.web.sourceSha ||
      opened.api?.versionId !== deployed.api.versionId ||
      opened.api?.sourceSha !== deployed.api.sourceSha
    ) {
      throw new Error("First publication gate opened with unexpected versions");
    }
    const publicResult = await publicCheck({
      sha,
      opened,
      deployed,
      webOrigin: env.RELEASE_WEB_ORIGIN,
      apiOrigin: env.RELEASE_API_ORIGIN,
      proxySecret: env.WEB_PROXY_SHARED_SECRET,
    });
    if (publicResult?.passed !== true) {
      throw new Error("First publication public check did not pass");
    }
    const deploymentId = await record(
      {
        environment: "production",
        sha,
        gateStatus: opened,
        publicCheckPassed: true,
        web: deployed.web,
        api: deployed.api,
      },
      githubDeployment,
    );
    const current = await gate.status();
    const baseline = await githubDeployment.readProductionBaseline(current);
    if (
      current.mode !== "open" ||
      current.targetSha !== sha ||
      baseline?.sha !== sha ||
      baseline.web?.versionId !== deployed.web.versionId ||
      baseline.api?.versionId !== deployed.api.versionId
    ) {
      throw new Error("First publication ledger does not match open gate");
    }
    return deploymentId;
  } catch (error) {
    try {
      const reclosed = await gate.reclose(sha);
      if (reclosed?.mode !== "maintenance" || reclosed.targetSha !== sha) {
        throw new Error("Maintenance reclose did not confirm the gate", {
          cause: error,
        });
      }
    } catch (recloseError) {
      throw new Error(
        "First publication incident: maintenance reclose failed",
        {
          cause: recloseError,
        },
      );
    }
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await runFirstProductionPublication(process.env);
    console.log("first_production_publication_passed");
  } catch (error) {
    console.error(
      error instanceof Error &&
        error.message ===
          "First publication incident: maintenance reclose failed"
        ? "first_production_publication_reclose_failed"
        : "first_production_publication_failed",
    );
    process.exitCode = 1;
  }
}
