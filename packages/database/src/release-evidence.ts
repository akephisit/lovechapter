export type WorkerVersion = { versionId: string; sourceSha: string };
export type ReleaseWorkerVersion = WorkerVersion & { changed: boolean };

export type ReleaseEvidenceContext = {
  environment: "staging" | "production";
  sha: string;
  closedAt: string;
  previousVersions: { web: WorkerVersion; api: WorkerVersion } | null;
  stagingSha: string | null;
};

export type ReleaseEvidence = {
  environment: "staging" | "production";
  commitSha: string;
  stagingSha: string | null;
  web: ReleaseWorkerVersion;
  api: ReleaseWorkerVersion;
  migration: "not_required" | "applied_and_validated";
  privateSmokePassed: true;
  inboxDelivery: "waived";
  acceptedAt: string;
};

const shaPattern = /^[0-9a-f]{40}$/u;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function canonicalTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function releaseVersion(
  value: unknown,
  previous: WorkerVersion | null,
  sha: string,
): ReleaseWorkerVersion {
  const input = record(value);
  if (
    typeof input?.versionId !== "string" ||
    !input.versionId.trim() ||
    typeof input.sourceSha !== "string" ||
    !shaPattern.test(input.sourceSha) ||
    typeof input.changed !== "boolean"
  ) {
    throw new Error("Release Worker version evidence is invalid");
  }
  if (input.changed) {
    if (
      input.sourceSha !== sha ||
      (previous && input.versionId === previous.versionId)
    ) {
      throw new Error("Changed Worker version is not from this release");
    }
  } else if (
    !previous ||
    input.versionId !== previous.versionId ||
    input.sourceSha !== previous.sourceSha
  ) {
    throw new Error("Unchanged Worker version does not match baseline");
  }
  return {
    versionId: input.versionId,
    sourceSha: input.sourceSha,
    changed: input.changed,
  };
}

export function validateReleaseEvidence(
  raw: string,
  context: ReleaseEvidenceContext,
): ReleaseEvidence {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Release evidence is invalid JSON");
  }
  const input = record(parsed);
  const closedAt = Date.parse(context.closedAt);
  if (
    !input ||
    !shaPattern.test(context.sha) ||
    !Number.isFinite(closedAt) ||
    input.environment !== context.environment ||
    input.commitSha !== context.sha ||
    !canonicalTimestamp(input.acceptedAt) ||
    Date.parse(input.acceptedAt) <= closedAt ||
    input.privateSmokePassed !== true ||
    input.inboxDelivery !== "waived" ||
    !["not_required", "applied_and_validated"].includes(
      String(input.migration),
    ) ||
    (context.environment === "production" &&
      (!context.stagingSha ||
        context.stagingSha !== context.sha ||
        input.stagingSha !== context.stagingSha))
  ) {
    throw new Error(
      "Release evidence is incomplete or targets another closure",
    );
  }
  const web = releaseVersion(
    input.web,
    context.previousVersions?.web ?? null,
    context.sha,
  );
  const api = releaseVersion(
    input.api,
    context.previousVersions?.api ?? null,
    context.sha,
  );
  if (!web.changed && !api.changed) {
    throw new Error("Release evidence contains no Worker deployment");
  }
  return {
    environment: context.environment,
    commitSha: context.sha,
    stagingSha:
      context.environment === "production" ? context.stagingSha : null,
    web,
    api,
    migration: input.migration as ReleaseEvidence["migration"],
    privateSmokePassed: true,
    inboxDelivery: "waived",
    acceptedAt: input.acceptedAt,
  };
}
