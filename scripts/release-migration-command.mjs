import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = resolve(root, "packages/database/src/release-migration-cli.ts");
const shaPattern = /^[0-9a-f]{40}$/u;
const migrationPath = /^packages\/database\/drizzle\/[A-Za-z0-9_-]+\.sql$/u;

/** Run reviewed migrations only after the coordinator has drained the gate. */
export function createReleaseMigrationCommand({
  env,
  runFile = execFileAsync,
}) {
  if (
    !["staging", "production"].includes(env?.RELEASE_ENVIRONMENT) ||
    typeof runFile !== "function"
  ) {
    throw new Error("Release migration environment is invalid");
  }
  return async (sha, { migration, closure }) => {
    if (
      !shaPattern.test(sha ?? "") ||
      !["nonbreaking", "breaking"].includes(migration?.kind) ||
      !Array.isArray(migration.paths) ||
      migration.paths.length === 0 ||
      migration.paths.length > 1000 ||
      new Set(migration.paths).size !== migration.paths.length ||
      !migration.paths.every((path) => migrationPath.test(path)) ||
      !Number.isFinite(Date.parse(closure?.changedAt ?? ""))
    ) {
      throw new Error("Release migration plan is invalid");
    }
    try {
      const args = [
        cliPath,
        "--sha",
        sha,
        "--closed-at",
        closure.changedAt,
        ...migration.paths.flatMap((path) => ["--reviewed", path]),
      ];
      const result = await runFile("bun", args, {
        cwd: root,
        env,
        timeout: 15 * 60_000,
        maxBuffer: 64 * 1024,
      });
      const parsed = JSON.parse(String(result.stdout).trim());
      if (
        parsed?.status !== "applied_and_validated" ||
        Object.keys(parsed).length !== 1
      ) {
        throw new Error("Release migration result is invalid");
      }
      return { status: "applied_and_validated" };
    } catch {
      throw new Error("Release migration command failed");
    }
  };
}
