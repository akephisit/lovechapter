const shaPattern = /^[0-9a-f]{40}$/u;

function canonicalTimestamp(value) {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function version(value) {
  return (
    typeof value?.versionId === "string" &&
    value.versionId.length > 0 &&
    shaPattern.test(value.sourceSha ?? "")
  );
}

/** Construct the exact changed/unchanged evidence consumed by the gate CLI. */
export function buildReleaseEvidence(input) {
  const {
    environment,
    sha,
    stagingSha,
    impact,
    previous,
    deployed,
    closure,
    smoke,
    migrationOutcome,
  } = input;
  if (
    !["staging", "production"].includes(environment) ||
    !shaPattern.test(sha ?? "") ||
    (environment === "production" && stagingSha !== sha) ||
    !impact ||
    typeof impact.web !== "boolean" ||
    typeof impact.backend !== "boolean" ||
    (!impact.web && !impact.backend) ||
    !canonicalTimestamp(smoke?.acceptedAt) ||
    !Number.isFinite(Date.parse(closure?.changedAt ?? "")) ||
    Date.parse(smoke.acceptedAt) <= Date.parse(closure.changedAt) ||
    smoke.passed !== true ||
    !["not_required", "applied_and_validated"].includes(migrationOutcome) ||
    impact.migrate !== (migrationOutcome === "applied_and_validated")
  ) {
    throw new Error("Release reopen evidence is incomplete");
  }
  const evidence = {
    environment,
    commitSha: sha,
    stagingSha: environment === "production" ? stagingSha : null,
    migration: migrationOutcome,
    privateSmokePassed: true,
    inboxDelivery: "waived",
    acceptedAt: smoke.acceptedAt,
  };
  for (const [component, changed] of [
    ["web", impact.web],
    ["api", impact.backend],
  ]) {
    const current = deployed?.[component];
    const old = previous?.[component];
    if (
      !version(current) ||
      (changed &&
        (current.sourceSha !== sha ||
          (old && current.versionId === old.versionId))) ||
      (!changed &&
        (!version(old) ||
          current.versionId !== old.versionId ||
          current.sourceSha !== old.sourceSha))
    ) {
      throw new Error("Release Worker version evidence is incomplete");
    }
    evidence[component] = {
      versionId: current.versionId,
      sourceSha: current.sourceSha,
      changed,
    };
  }
  return evidence;
}
