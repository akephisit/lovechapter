import { runCutover as defaultRunCutover } from "./release-orchestrator.mjs";
import { resolveReleasePlan } from "./release-plan.mjs";

const shaPattern = /^[0-9a-f]{40}$/u;

function validVersion(value) {
  return (
    typeof value?.versionId === "string" &&
    value.versionId.length > 0 &&
    shaPattern.test(value.sourceSha ?? "")
  );
}

function acceptedGate(state) {
  if (
    state?.mode !== "open" ||
    !shaPattern.test(state.targetSha ?? "") ||
    !validVersion(state.web) ||
    !validVersion(state.api)
  ) {
    throw new Error("Release gate has no accepted Worker baseline");
  }
  return {
    sha: state.targetSha,
    web: {
      versionId: state.web.versionId,
      sourceSha: state.web.sourceSha,
    },
    api: {
      versionId: state.api.versionId,
      sourceSha: state.api.sourceSha,
    },
  };
}

function sameBaseline(left, right) {
  return (
    left?.sha === right.sha &&
    ["web", "api"].every(
      (component) =>
        left[component]?.versionId === right[component].versionId &&
        left[component]?.sourceSha === right[component].sourceSha,
    )
  );
}

/** Resolve the real accepted baseline before creating any deploy-capable driver. */
export async function executeRelease(
  { environment, sha },
  {
    gate,
    ledger,
    resolvePlan = resolveReleasePlan,
    createDriver,
    runCutover = defaultRunCutover,
  } = {},
) {
  if (
    !["staging", "production"].includes(environment) ||
    !shaPattern.test(sha ?? "") ||
    typeof gate?.status !== "function" ||
    typeof resolvePlan !== "function" ||
    typeof runCutover !== "function" ||
    (environment === "production" &&
      typeof ledger?.readProductionBaseline !== "function")
  ) {
    throw new Error("Release execution inputs are incomplete");
  }
  const gateState = await gate.status();
  const gateBaseline = acceptedGate(gateState);
  const baseline =
    environment === "production"
      ? await ledger.readProductionBaseline(gateState)
      : gateBaseline;
  if (!sameBaseline(baseline, gateBaseline)) {
    throw new Error("Release baseline does not match the open gate");
  }
  const plan = await resolvePlan({ baselineSha: baseline.sha, sha });
  if (
    plan?.baselineSha !== baseline.sha ||
    plan.sha !== sha ||
    typeof plan.impact?.web !== "boolean" ||
    typeof plan.impact?.backend !== "boolean" ||
    typeof plan.impact?.migrate !== "boolean" ||
    !["none", "nonbreaking", "breaking"].includes(plan.migration?.kind) ||
    plan.impact.migrate !== (plan.migration.kind !== "none") ||
    (plan.impact.migrate && !plan.impact.web && !plan.impact.backend)
  ) {
    throw new Error("Release plan differs from accepted baseline");
  }
  if (!plan.impact?.web && !plan.impact?.backend && !plan.impact?.migrate) {
    return { status: "skipped", reason: "docs_only", sha };
  }
  if (typeof createDriver !== "function") {
    throw new Error("Release driver is unavailable");
  }
  const driver = createDriver({
    environment,
    sha,
    impact: plan.impact,
    previous: { web: baseline.web, api: baseline.api },
  });
  return runCutover(
    { environment, sha, impact: plan.impact, migration: plan.migration },
    driver,
  );
}
