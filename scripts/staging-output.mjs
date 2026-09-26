import { appendFile } from "node:fs/promises";

import { REQUIRED_STAGING_CHECKS } from "./release-orchestrator.mjs";

const shaPattern = /^[0-9a-f]{40}$/u;

function accepted(value, sha) {
  if (
    !shaPattern.test(sha ?? "") ||
    value?.commitSha !== sha ||
    value.inboxDelivery !== "waived" ||
    !Array.isArray(value.checks) ||
    value.checks.length !== REQUIRED_STAGING_CHECKS.length ||
    new Set(value.checks).size !== REQUIRED_STAGING_CHECKS.length ||
    !REQUIRED_STAGING_CHECKS.every((check) => value.checks.includes(check))
  ) {
    throw new Error("Exact-SHA staging handoff is incomplete");
  }
  return {
    commitSha: sha,
    checks: [...REQUIRED_STAGING_CHECKS],
    inboxDelivery: "waived",
  };
}

/** Project a safe same-run output; never write a provider or fixture payload. */
export async function writeStagingOutput(
  result,
  outputPath,
  appendOutput = appendFile,
) {
  if (
    result?.status !== "released" ||
    result.environment !== "staging" ||
    typeof outputPath !== "string" ||
    !outputPath.trim() ||
    typeof appendOutput !== "function"
  ) {
    throw new Error("Staging release has no accepted output");
  }
  const projected = accepted(result.recorded?.stagingAcceptance, result.sha);
  await appendOutput(
    outputPath,
    `accepted_sha=${result.sha}\nacceptance=${JSON.stringify(projected)}\n`,
  );
}

/** Production consumes only the prior staging job's exact projected output. */
export function parseStagingOutput(encoded, sha) {
  try {
    const value = JSON.parse(encoded);
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      Object.keys(value).length !== 3
    ) {
      throw new Error("Invalid staging output");
    }
    return accepted(value, sha);
  } catch {
    throw new Error("Exact-SHA staging output is unavailable");
  }
}
