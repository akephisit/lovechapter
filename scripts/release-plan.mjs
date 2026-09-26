import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateMigrationReviews } from "./migration-review.mjs";
import { createReleasePlan, parseGitChanges } from "./release-impact.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shaPattern = /^[0-9a-f]{40}$/u;

function localGit(args) {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new Error("Release Git history is unavailable");
  }
}

/** Derive impact from a verified accepted baseline, never the push before-SHA. */
export async function resolveReleasePlan(
  { baselineSha, sha },
  { runGit = localGit, readReview } = {},
) {
  if (!shaPattern.test(baselineSha ?? "") || !shaPattern.test(sha ?? "")) {
    throw new Error("Release baseline and candidate require full SHAs");
  }
  if (runGit(["rev-parse", "HEAD"]).trim() !== sha) {
    throw new Error("Checked-out release SHA differs from candidate");
  }
  try {
    runGit(["merge-base", "--is-ancestor", baselineSha, sha]);
  } catch {
    throw new Error("Release baseline is not an ancestor of candidate");
  }
  const changes = parseGitChanges(
    runGit(["diff", "--no-renames", "--name-status", "-z", baselineSha, sha]),
  );
  const plan = createReleasePlan(changes, "worker");
  const impact = {
    web: plan.web,
    backend: plan.backend,
    migrate: plan.migrate,
  };
  const migration = await validateMigrationReviews(changes, readReview);
  if (migration.kind === "blocked") {
    throw new Error("Reviewed migration is blocked from automatic release");
  }
  if (impact.migrate !== (migration.kind !== "none")) {
    throw new Error("Migration plan does not match release impact");
  }
  return { baselineSha, sha, impact, migration };
}
