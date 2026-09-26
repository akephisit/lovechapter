import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { parseStagingOutput } from "./staging-output.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = resolve(root, "scripts/staging-acceptance-cli.mjs");
const shaPattern = /^[0-9a-f]{40}$/u;

/** Keep long-running staging probes isolated from the release coordinator. */
export function createStagingAcceptanceCommand({
  env,
  runFile = execFileAsync,
}) {
  if (env?.RELEASE_ENVIRONMENT !== "staging" || typeof runFile !== "function") {
    throw new Error("Staging acceptance environment is invalid");
  }
  return async (sha) => {
    if (!shaPattern.test(sha ?? "")) {
      throw new Error("Staging acceptance SHA is invalid");
    }
    try {
      const result = await runFile("bun", [cliPath, sha], {
        cwd: root,
        env,
        timeout: 25 * 60_000,
        maxBuffer: 64 * 1024,
      });
      return parseStagingOutput(String(result.stdout).trim(), sha);
    } catch {
      throw new Error("Staging acceptance command failed");
    }
  };
}

/** Provider/branch preflight runs before build, closure, or staging fixtures. */
export function createStagingAcceptancePreflightCommand({
  env,
  runFile = execFileAsync,
}) {
  if (env?.RELEASE_ENVIRONMENT !== "staging" || typeof runFile !== "function") {
    throw new Error("Staging acceptance environment is invalid");
  }
  return async (sha) => {
    if (!shaPattern.test(sha ?? "")) {
      throw new Error("Staging acceptance SHA is invalid");
    }
    try {
      const result = await runFile("bun", [cliPath, sha, "--preflight"], {
        cwd: root,
        env,
        timeout: 60_000,
        maxBuffer: 64 * 1024,
      });
      const parsed = JSON.parse(String(result.stdout).trim());
      if (parsed?.targetVerified !== true || Object.keys(parsed).length !== 1) {
        throw new Error("Staging acceptance preflight is invalid");
      }
      return { targetVerified: true };
    } catch {
      throw new Error("Staging acceptance preflight failed");
    }
  };
}
