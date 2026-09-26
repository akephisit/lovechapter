const shaPattern = /^[0-9a-f]{40}$/u;
const task = "lovechapter-worker-release";

function sameVersion(left, right) {
  return (
    left &&
    right &&
    typeof left.versionId === "string" &&
    left.versionId.length > 0 &&
    shaPattern.test(left.sourceSha) &&
    left.versionId === right.versionId &&
    left.sourceSha === right.sourceSha
  );
}

/** Return null unless durable GitHub and PostgreSQL state agree exactly. */
export function selectProductionBaseline(deployments, statuses, gateStatus) {
  if (
    gateStatus?.mode !== "open" ||
    !shaPattern.test(gateStatus.targetSha ?? "")
  ) {
    return null;
  }
  const latestDeployment = deployments
    .filter(
      (deployment) =>
        deployment.environment === "production" && deployment.task === task,
    )
    .sort((left, right) => right.id - left.id)[0];
  if (
    !latestDeployment ||
    latestDeployment.sha !== gateStatus.targetSha ||
    !sameVersion(latestDeployment.payload?.web, gateStatus.web) ||
    !sameVersion(latestDeployment.payload?.api, gateStatus.api)
  ) {
    return null;
  }
  const latestStatus = statuses
    .filter((status) => status.deployment_id === latestDeployment.id)
    .sort((left, right) => right.id - left.id)[0];
  if (latestStatus?.state !== "success") return null;
  return {
    sha: latestDeployment.sha,
    web: {
      versionId: latestDeployment.payload.web.versionId,
      sourceSha: latestDeployment.payload.web.sourceSha,
    },
    api: {
      versionId: latestDeployment.payload.api.versionId,
      sourceSha: latestDeployment.payload.api.sourceSha,
    },
  };
}

/** The caller must pass the post-open, post-public-check result. */
export async function recordDeployment(result, githubClient) {
  if (
    result?.environment !== "production" ||
    !shaPattern.test(result.sha ?? "") ||
    result.gateStatus?.mode !== "open" ||
    result.gateStatus.targetSha !== result.sha ||
    result.publicCheckPassed !== true ||
    !sameVersion(result.web, result.gateStatus.web) ||
    !sameVersion(result.api, result.gateStatus.api)
  ) {
    throw new Error("Production deployment is not eligible for success");
  }
  const deployment = await githubClient.createDeployment({
    ref: result.sha,
    environment: "production",
    task,
    payload: {
      web: {
        versionId: result.web.versionId,
        sourceSha: result.web.sourceSha,
      },
      api: {
        versionId: result.api.versionId,
        sourceSha: result.api.sourceSha,
      },
    },
    auto_merge: false,
    required_contexts: [],
  });
  if (!Number.isSafeInteger(deployment?.id)) {
    throw new Error("GitHub deployment record is unavailable");
  }
  await githubClient.createDeploymentStatus(deployment.id, {
    state: "success",
    environment: "production",
  });
  return deployment.id;
}
