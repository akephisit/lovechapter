import { recordDeployment } from "./deployment-ledger.mjs";
import { buildReleaseEvidence } from "./release-evidence-builder.mjs";
import {
  canonicalSecret,
  runPrivateReleaseSmoke,
  runPublicReleaseCheck,
  workerOrigin,
} from "./release-smoke.mjs";
import {
  deployPreparedVersions,
  prepareWorkerVersions,
} from "./worker-versions.mjs";

const shaPattern = /^[0-9a-f]{40}$/u;

function validVersion(value) {
  return (
    typeof value?.versionId === "string" &&
    value.versionId.length > 0 &&
    shaPattern.test(value.sourceSha ?? "")
  );
}

/** Bind the verified release adapters without granting the CLI a bypass path. */
export function createReleaseDriver(config) {
  const {
    environment,
    sha,
    impact,
    previous,
    hyperdriveId,
    workerRunner,
    gate,
    githubRead,
    githubDeployment,
    webOrigin,
    apiOrigin,
    proxySecret,
    probeSecret,
    stagingSha,
    verifyStaging,
    verifyProduction,
    applyMigration,
    acceptStaging,
    fetcher = globalThis.fetch,
    now = () => new Date(),
  } = config ?? {};
  const acceptedWebOrigin = workerOrigin(webOrigin);
  const acceptedApiOrigin = workerOrigin(apiOrigin);
  const workerSuffix = environment === "staging" ? "-staging" : "";
  if (
    !["staging", "production"].includes(environment) ||
    !shaPattern.test(sha ?? "") ||
    typeof impact?.web !== "boolean" ||
    typeof impact?.backend !== "boolean" ||
    typeof impact?.migrate !== "boolean" ||
    !validVersion(previous?.web) ||
    !validVersion(previous?.api) ||
    !hyperdriveId ||
    !workerRunner ||
    !gate ||
    !["status", "close", "drain", "open", "reclose"].every(
      (method) => typeof gate[method] === "function",
    ) ||
    typeof githubRead?.readMainHead !== "function" ||
    typeof applyMigration !== "function" ||
    typeof fetcher !== "function" ||
    typeof now !== "function" ||
    !acceptedWebOrigin ||
    !acceptedApiOrigin ||
    acceptedWebOrigin === acceptedApiOrigin ||
    (acceptedWebOrigin &&
      new globalThis.URL(acceptedWebOrigin).hostname.split(".")[0] !==
        `lovechapter-web${workerSuffix}`) ||
    (acceptedApiOrigin &&
      new globalThis.URL(acceptedApiOrigin).hostname.split(".")[0] !==
        `lovechapter-api${workerSuffix}`) ||
    !canonicalSecret(proxySecret) ||
    !canonicalSecret(probeSecret) ||
    proxySecret === probeSecret ||
    (environment === "staging" &&
      (typeof verifyStaging !== "function" ||
        typeof acceptStaging !== "function")) ||
    (environment === "production" &&
      (stagingSha !== sha ||
        typeof verifyProduction !== "function" ||
        typeof githubDeployment?.createDeployment !== "function" ||
        typeof githubDeployment?.createDeploymentStatus !== "function"))
  ) {
    throw new Error("Worker release driver is incomplete");
  }
  async function assertGateBaseline() {
    const status = await gate.status();
    if (
      status?.mode !== "open" ||
      !shaPattern.test(status.targetSha ?? "") ||
      !["web", "api"].every(
        (component) =>
          status[component]?.versionId === previous[component].versionId &&
          status[component]?.sourceSha === previous[component].sourceSha,
      )
    ) {
      throw new Error("Release gate baseline does not match active Workers");
    }
  }
  return {
    readMainHead: () => githubRead.readMainHead(),
    async verifyStaging(candidate, input) {
      await assertGateBaseline();
      return verifyStaging(candidate, input);
    },
    async verifyProduction(candidate, input) {
      await assertGateBaseline();
      return verifyProduction(candidate, input);
    },
    prepare: (candidate) =>
      prepareWorkerVersions(
        {
          environment,
          impact,
          sha: candidate,
          previous,
          hyperdriveId,
        },
        workerRunner,
      ),
    async close(candidate) {
      await assertGateBaseline();
      return gate.close(candidate);
    },
    drain: (candidate) => gate.drain(candidate),
    migrate: (candidate, context) => applyMigration(candidate, context),
    deploy: (_candidate, { prepared }) =>
      deployPreparedVersions(prepared, workerRunner),
    privateSmoke: (candidate, { closure, deployed }) =>
      runPrivateReleaseSmoke(
        {
          sha: candidate,
          closure,
          deployed,
          webOrigin,
          apiOrigin,
          proxySecret,
          probeSecret,
        },
        { fetcher, now },
      ),
    open: (candidate, { closure, deployed, migrationOutcome, smoke }) =>
      gate.open(
        candidate,
        buildReleaseEvidence({
          environment,
          sha: candidate,
          stagingSha,
          impact,
          previous,
          deployed,
          closure,
          smoke,
          migrationOutcome,
        }),
      ),
    async publicCheck(candidate, { opened, deployed }) {
      const publicResult = await runPublicReleaseCheck(
        {
          sha: candidate,
          opened,
          deployed,
          webOrigin,
          apiOrigin,
          proxySecret,
        },
        { fetcher },
      );
      if (environment === "production") return publicResult;
      return {
        ...publicResult,
        stagingAcceptance: await acceptStaging(candidate),
      };
    },
    async record(candidate, { deployed, opened, publicResult }) {
      if (environment === "staging") {
        return { stagingAcceptance: publicResult.stagingAcceptance };
      }
      return recordDeployment(
        {
          environment,
          sha: candidate,
          gateStatus: opened,
          publicCheckPassed: publicResult.passed,
          web: deployed.web,
          api: deployed.api,
        },
        githubDeployment,
      );
    },
    reclose: (candidate) => gate.reclose(candidate),
  };
}
