import console from "node:console";
import process from "node:process";

import pg from "pg";

import { releaseTargetFromEnvironment } from "../packages/database/src/release-gate-cli.ts";
import { PostgresReleaseGateController } from "../packages/database/src/release-gate-repository.ts";
import {
  loadReleaseInventory,
  validateDirectDatabaseUrl,
  verifyReleaseTarget,
} from "../packages/database/src/release-target.ts";
import {
  createPostgresFixtureStore,
  runStagingHttpAcceptance,
} from "./acceptance/staging-http.mjs";
import {
  createPostgresJobMarkerStore,
  DEFAULT_JOB_DEADLINES,
  runStagingJobsAcceptance,
} from "./acceptance/staging-jobs.mjs";
import { runStagingAcceptance } from "./staging-acceptance.mjs";
import { runQueryPlanProbe } from "./staging-query-plan-probe.mjs";

const shaPattern = /^[0-9a-f]{40}$/u;

function required(env, name) {
  const value = env[name];
  if (!value || !value.trim() || value.startsWith("REPLACE_WITH_")) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function testBranchInventory(branchId, projectId, apiKey, fetcher) {
  try {
    const response = await fetcher(
      `https://console.neon.tech/api/v2/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}/endpoints`,
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: "application/json",
        },
        signal: globalThis.AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok) throw new Error("provider status");
    const body = await response.json();
    if (!Array.isArray(body?.endpoints)) throw new Error("provider response");
    return {
      endpoints: body.endpoints.map((value) => ({
        branch_id: value.branch_id,
        host: value.host,
        type: value.type,
      })),
    };
  } catch {
    throw new Error("Isolated Neon branch inventory unavailable");
  }
}

/** Test the opened staging SHA through real HTTP, scheduled jobs, and isolated SQL. */
export async function runStagingAcceptanceCli(
  sha,
  env,
  {
    fetcher = globalThis.fetch,
    createClient = (connectionString) =>
      new pg.Client({ connectionString, connectionTimeoutMillis: 5_000 }),
    readGateStatus = (client) =>
      new PostgresReleaseGateController(client).status(),
    http = runStagingHttpAcceptance,
    jobs = runStagingJobsAcceptance,
    plans = runQueryPlanProbe,
    write = console.log,
    preflightOnly = false,
  } = {},
) {
  try {
    if (
      !shaPattern.test(sha ?? "") ||
      env?.GITHUB_ACTIONS !== "true" ||
      env.GITHUB_SHA !== sha ||
      env.RELEASE_ENVIRONMENT !== "staging" ||
      env.RELEASE_POSTGRES_JOB_RESULT !== "success"
    ) {
      throw new Error("Same-SHA staging CI evidence is unavailable");
    }
    const target = releaseTargetFromEnvironment(env);
    const webOrigin = required(env, "RELEASE_WEB_ORIGIN");
    const testEmail = required(env, "RELEASE_TEST_EMAIL");
    const testPassword = required(env, "RELEASE_TEST_PASSWORD");
    const verificationEmail = required(env, "RELEASE_VERIFICATION_EMAIL");
    const foreignWeddingId = required(env, "RELEASE_FOREIGN_WEDDING_ID");
    const testDatabaseUrl = required(env, "RELEASE_TEST_DATABASE_URL");
    const testBranchId = required(env, "RELEASE_TEST_BRANCH_ID");
    if (required(env, "RELEASE_TEST_DATABASE_CONFIRM") !== "lovechapter_test") {
      throw new Error("Isolated query-plan database confirmation is absent");
    }
    const testUrl = validateDirectDatabaseUrl(testDatabaseUrl);
    const neonApiKey = required(env, "RELEASE_NEON_API_KEY");
    const inventory = await loadReleaseInventory(
      target,
      {
        neonApiKey,
        cloudflareApiToken: required(env, "RELEASE_CLOUDFLARE_API_TOKEN"),
      },
      fetcher,
    );
    const verified = verifyReleaseTarget(target, inventory);
    if (
      testUrl.hostname === verified.host ||
      testBranchId === verified.branchId ||
      decodeURIComponent(testUrl.pathname.slice(1)) !== target.database
    ) {
      throw new Error("Query-plan branch is not isolated from staging");
    }
    const testInventory = await testBranchInventory(
      testBranchId,
      target.neonProjectId,
      neonApiKey,
      fetcher,
    );
    if (
      testInventory.endpoints.filter(
        (endpoint) =>
          endpoint.branch_id === testBranchId &&
          endpoint.host === testUrl.hostname &&
          endpoint.type === "read_write",
      ).length !== 1
    ) {
      throw new Error("Query-plan URL is not the isolated Neon branch");
    }
    if (preflightOnly === true) {
      const report = { targetVerified: true };
      write(JSON.stringify(report));
      return report;
    }
    const client = createClient(target.directUrl);
    let result;
    try {
      await client.connect();
      const before = await readGateStatus(client);
      if (before?.mode !== "open" || before.targetSha !== sha) {
        throw new Error("Staging gate is not open for this SHA");
      }
      const fixtureStore = createPostgresFixtureStore({
        client,
        foreignWeddingId,
        verificationEmail,
      });
      const jobsStore = createPostgresJobMarkerStore({
        client,
        webOrigin,
        testEmail,
        fetcher,
      });
      result = await runStagingAcceptance(sha, {
        http: () =>
          http(
            { webOrigin, testEmail, testPassword, verificationEmail, sha },
            { fetcher, fixtureStore },
          ),
        jobs: () =>
          jobs({ sha, deadlines: DEFAULT_JOB_DEADLINES }, { store: jobsStore }),
        queryPlans: () =>
          plans(
            {
              testDatabaseUrl,
              activeStagingHost: verified.host,
              expectedTestBranchId: testBranchId,
              confirm: "lovechapter_test",
            },
            (config) => new pg.Client(config),
            (branchId) =>
              testBranchInventory(
                branchId,
                target.neonProjectId,
                neonApiKey,
                fetcher,
              ),
          ),
        retryEvidence: {
          commitSha: sha,
          check: "postgres_retry",
          passed: true,
          source: "same_sha_postgres_job",
        },
      });
      const after = await readGateStatus(client);
      if (after?.mode !== "open" || after.targetSha !== sha) {
        throw new Error("Staging gate changed during acceptance");
      }
    } finally {
      await client.end();
    }
    write(JSON.stringify(result));
    return result;
  } catch {
    throw new Error("Staging acceptance failed");
  }
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    if (
      ![1, 2].includes(args.length) ||
      (args.length === 2 && args[1] !== "--preflight")
    ) {
      throw new Error("Invalid staging acceptance command");
    }
    await runStagingAcceptanceCli(args[0], process.env, {
      preflightOnly: args[1] === "--preflight",
    });
  } catch {
    console.error("staging_acceptance_failed");
    process.exitCode = 1;
  }
}
