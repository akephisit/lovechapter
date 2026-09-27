const idPattern = /^[a-z0-9-]{1,60}$/u;
const shaPattern = /^[0-9a-f]{40}$/u;
const operationIdPattern = /^[0-9a-f-]{36}$/u;
const apiBase = "https://console.neon.tech/api/v2";

function assertInput({ projectId, branchId, sha, closedAt, apiKey }) {
  if (
    !idPattern.test(projectId ?? "") ||
    !idPattern.test(branchId ?? "") ||
    !shaPattern.test(sha ?? "") ||
    !Number.isFinite(Date.parse(closedAt ?? "")) ||
    typeof apiKey !== "string" ||
    !apiKey.trim()
  ) {
    throw new Error("Neon recovery-point input is incomplete");
  }
}

async function readJson(fetcher, url, apiKey, method = "GET") {
  let response;
  try {
    response = await fetcher(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("Neon recovery-point request was ambiguous");
  }
  if (!response?.ok) {
    throw new Error("Neon recovery-point request was rejected");
  }
  try {
    return await response.json();
  } catch {
    throw new Error("Neon recovery-point response was invalid");
  }
}

/** Create once; an ambiguous POST requires manual inspection, never an automatic retry. */
export async function createNeonRecoveryPoint(
  input,
  {
    fetcher = fetch,
    wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    maxAttempts = 12,
  } = {},
) {
  assertInput(input);
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 30
  ) {
    throw new Error("Neon recovery-point poll limit is invalid");
  }
  const { projectId, branchId, sha, closedAt, apiKey } = input;
  const projectUrl = `${apiBase}/projects/${projectId}`;
  const name = `lovechapter-pre-migration-${sha}-${closedAt.replace(/[^0-9]/gu, "")}`;
  const createUrl = `${projectUrl}/branches/${branchId}/snapshot?name=${encodeURIComponent(name)}`;
  const created = await readJson(fetcher, createUrl, apiKey, "POST");
  const snapshot = created?.snapshot;
  if (
    !idPattern.test(snapshot?.id ?? "") ||
    snapshot.source_branch_id !== branchId ||
    !Array.isArray(created.operations)
  ) {
    throw new Error("Neon recovery-point creation could not be verified");
  }

  for (const operation of created.operations) {
    if (!operationIdPattern.test(operation?.id ?? "")) {
      throw new Error("Neon recovery-point operation ID is invalid");
    }
    let finished = false;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (attempt > 0) await wait(1_500);
      const body = await readJson(
        fetcher,
        `${projectUrl}/operations/${operation.id}`,
        apiKey,
      );
      const current = body?.operation;
      if (
        current?.id !== operation.id ||
        current.project_id !== projectId ||
        (current.branch_id && current.branch_id !== branchId)
      ) {
        throw new Error("Neon recovery-point operation identity changed");
      }
      if (current.status === "finished") {
        finished = true;
        break;
      }
      if (!["scheduling", "running"].includes(current.status)) {
        throw new Error("Neon recovery-point operation failed");
      }
    }
    if (!finished) throw new Error("Neon recovery-point operation timed out");
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) await wait(1_500);
    const body = await readJson(fetcher, `${projectUrl}/snapshots`, apiKey);
    if (!Array.isArray(body?.snapshots)) {
      throw new Error("Neon recovery-point list was invalid");
    }
    const confirmed = body.snapshots.find((item) => item.id === snapshot.id);
    if (!confirmed) continue;
    if (confirmed.source_branch_id !== branchId) {
      throw new Error("Neon recovery-point source branch differs");
    }
    return { snapshotId: snapshot.id, sourceBranchId: branchId };
  }
  throw new Error("Neon recovery point was not visible after bounded readback");
}
