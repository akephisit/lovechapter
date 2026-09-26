import { execFileSync } from "node:child_process";
import process from "node:process";
import { pathToFileURL } from "node:url";

/** Fail closed: an unfamiliar executable/configuration path deploys both sides. */
export function classifyReleaseImpact(paths) {
  if (
    paths.includes("packages/database/src/schema.ts") &&
    !paths.some(
      (path) =>
        path.startsWith("packages/database/drizzle/") && path.endsWith(".sql"),
    )
  ) {
    throw new Error(
      "Schema source changed without a SQL migration; review the schema and generate a migration before release",
    );
  }

  const impact = { web: false, backend: false, migrate: false };

  for (const path of paths) {
    if (path.startsWith("apps/web/")) {
      impact.web = true;
    } else if (
      path.startsWith("apps/api/") ||
      path.startsWith("apps/jobs/") ||
      path.startsWith("packages/auth/") ||
      path.startsWith("packages/database/")
    ) {
      impact.backend = true;
      if (path.startsWith("packages/database/drizzle/")) {
        impact.web = true;
        impact.migrate = true;
      }
    } else if (
      path.startsWith("packages/contracts/") ||
      path.startsWith("packages/domain/")
    ) {
      impact.web = true;
      impact.backend = true;
    } else if (
      path.endsWith(".md") ||
      path.startsWith("docs/") ||
      path === ".gitignore"
    ) {
      continue;
    } else {
      impact.web = true;
      impact.backend = true;
    }
  }

  return impact;
}

export function createReleasePlan(paths, backendRuntime) {
  if (backendRuntime !== "worker" && backendRuntime !== "bun-vps") {
    throw new Error("Select exactly one backend runtime: worker or bun-vps");
  }

  return { ...classifyReleaseImpact(paths), backendRuntime };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [backendRuntime, base, head] = process.argv.slice(2);
  if (
    !base ||
    !head ||
    !/^[a-f0-9]{40}$/.test(base) ||
    !/^[a-f0-9]{40}$/.test(head)
  ) {
    throw new Error("Expected full base and head Git commit SHAs");
  }

  // Treat a cross-component rename as a deletion plus an addition.
  const changed = execFileSync(
    "git",
    ["diff", "--no-renames", "--name-only", "-z", base, head],
    {
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean);
  const plan = createReleasePlan(changed, backendRuntime);
  for (const [name, value] of Object.entries(plan)) {
    process.stdout.write(`${name}=${value}\n`);
  }
}
