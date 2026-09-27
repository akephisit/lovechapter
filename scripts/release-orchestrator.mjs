const shaPattern = /^[0-9a-f]{40}$/u;

function assertProductionPreflight(preflight) {
  if (
    preflight?.releaseEnabled !== true ||
    preflight.protectedMain !== true ||
    preflight.targetVerified !== true ||
    !shaPattern.test(preflight.baseline?.expectedSha ?? "") ||
    preflight.baseline.expectedSha !== preflight.baseline.currentSha
  ) {
    throw new Error("Production release preflight is incomplete");
  }
}

function assertInput({ environment, sha, impact, migration }) {
  if (
    environment !== "production" ||
    !shaPattern.test(sha ?? "") ||
    typeof impact?.web !== "boolean" ||
    typeof impact?.backend !== "boolean" ||
    typeof impact?.migrate !== "boolean" ||
    !["none", "nonbreaking", "breaking"].includes(migration?.kind) ||
    impact.migrate !== (migration.kind !== "none") ||
    (!impact.web && !impact.backend && impact.migrate)
  ) {
    throw new Error("Worker release plan is invalid");
  }
}

function assertGate(state, mode, sha) {
  if (state?.mode !== mode || state.targetSha !== sha) {
    throw new Error(`Release gate is not ${mode} for this SHA`);
  }
}

function assertOpenedVersions(opened, deployed) {
  for (const component of ["web", "api"]) {
    if (
      opened?.[component]?.versionId !== deployed[component].versionId ||
      opened[component].sourceSha !== deployed[component].sourceSha
    ) {
      throw new Error("Opened gate Worker versions do not match deployment");
    }
  }
}

async function assertCurrentMain(sha, driver) {
  if ((await driver.readMainHead(sha)) !== sha) {
    throw new Error("Release SHA was superseded on main");
  }
}

/** The only normal route from prepared Worker versions to an opened site. */
export async function runCutover(input, driver) {
  assertInput(input);
  const { environment, sha, impact, migration } = input;
  if (!impact.web && !impact.backend) {
    return { status: "skipped", reason: "docs_only", sha };
  }

  await assertCurrentMain(sha, driver);

  assertProductionPreflight(await driver.verifyProduction(sha, input));

  const prepared = await driver.prepare(sha, {
    environment,
    impact,
    migration,
  });
  if (prepared?.sha !== sha) throw new Error("Prepared artifact SHA differs");

  await assertCurrentMain(sha, driver);

  const closure = await driver.close(sha, prepared);
  assertGate(closure, "maintenance", sha);
  if (!Number.isFinite(Date.parse(closure.changedAt ?? ""))) {
    throw new Error("Release closure has no timestamp");
  }
  const drained = await driver.drain(sha, closure);
  assertGate(drained, "maintenance", sha);
  if (drained.activeCount !== 0) {
    throw new Error("Release gate still has active leases");
  }

  if (migration.kind === "breaking") {
    const point = await driver.createRecoveryPoint(sha, { closure });
    if (!point?.snapshotId || !point?.sourceBranchId) {
      throw new Error("Breaking migration recovery point is unverified");
    }
  }

  let migrationOutcome = "not_required";
  if (migration.kind !== "none") {
    const migrated = await driver.migrate(sha, { migration, closure });
    if (migrated?.status !== "applied_and_validated") {
      throw new Error("Reviewed migration was not validated");
    }
    migrationOutcome = migrated.status;
  }
  const deployed = await driver.deploy(sha, { prepared, closure });
  if (
    !deployed?.web?.versionId ||
    !shaPattern.test(deployed.web.sourceSha ?? "") ||
    !deployed?.api?.versionId ||
    !shaPattern.test(deployed.api.sourceSha ?? "")
  ) {
    throw new Error("Deployed Worker version evidence is incomplete");
  }
  const smoke = await driver.privateSmoke(sha, {
    closure,
    deployed,
    migrationOutcome,
  });
  if (
    smoke?.passed !== true ||
    !Number.isFinite(Date.parse(smoke.acceptedAt ?? "")) ||
    Date.parse(smoke.acceptedAt) <= Date.parse(closure.changedAt)
  ) {
    throw new Error("Post-closure private smoke is incomplete");
  }
  try {
    // An open command can commit and then lose its response. Always reclose
    // after an ambiguous open result instead of assuming it stayed closed.
    const opened = await driver.open(sha, {
      closure,
      deployed,
      migrationOutcome,
      smoke,
    });
    assertGate(opened, "open", sha);
    assertOpenedVersions(opened, deployed);
    const publicResult = await driver.publicCheck(sha, {
      closure,
      deployed,
      opened,
      migrationOutcome,
      smoke,
    });
    if (publicResult?.passed !== true) {
      throw new Error("Post-open public check failed");
    }
    const recorded = await driver.record(sha, {
      environment,
      impact,
      migrationOutcome,
      deployed,
      smoke,
      opened,
      publicResult,
    });
    return { status: "released", environment, sha, deployed, recorded };
  } catch (error) {
    try {
      const reclosed = await driver.reclose(sha);
      assertGate(reclosed, "maintenance", sha);
    } catch {
      throw new Error("Release incident: post-open failure and reclose failed");
    }
    throw error;
  }
}
