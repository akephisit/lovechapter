import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiDirectory = resolve(root, "apps/api");
const wrangler = resolve(root, "node_modules/wrangler/bin/wrangler.js");

function hyperdriveId(output) {
  return /\benv\.HYPERDRIVE \(([^)\n]+)\)/.exec(output)?.[1];
}

export function validateStagingApiDryRuns(stagingOutput, defaultOutput) {
  if (
    stagingOutput.includes(
      'No environment found in configuration with name "staging"',
    )
  ) {
    throw new Error(
      "staging environment is missing; refusing to deploy the default Worker",
    );
  }

  const stagingId = hyperdriveId(stagingOutput);
  if (!stagingId || stagingId.startsWith("REPLACE_WITH_")) {
    throw new Error("staging Hyperdrive ID is not configured");
  }

  const defaultId = hyperdriveId(defaultOutput);
  if (!defaultId) {
    throw new Error("default Hyperdrive ID could not be inspected");
  }
  if (stagingId === defaultId) {
    throw new Error("staging must not use the default Hyperdrive ID");
  }
}

function dryRun(environment) {
  const result = spawnSync(
    process.execPath,
    [
      wrangler,
      "deploy",
      "--dry-run",
      "--config",
      "wrangler.jsonc",
      ...(environment ? ["--env", environment] : []),
    ],
    { cwd: apiDirectory, encoding: "utf8", timeout: 60_000 },
  );
  if (result.error || result.status !== 0) {
    throw new Error(`${environment ?? "default"} Worker dry-run failed`);
  }
  return `${result.stdout}\n${result.stderr}`;
}

export function requireSecretsFileArgument(argumentsAfterScript) {
  if (
    argumentsAfterScript.length !== 2 ||
    argumentsAfterScript[0] !== "--secrets-file"
  ) {
    throw new Error(
      "usage: npm run deploy:worker:staging --workspace @lovechapter/api -- --secrets-file .env.staging",
    );
  }
  return argumentsAfterScript[1];
}

function deploy() {
  const secretsFileArgument = requireSecretsFileArgument(process.argv.slice(2));
  const secretsFile = isAbsolute(secretsFileArgument)
    ? secretsFileArgument
    : resolve(apiDirectory, secretsFileArgument);
  const file = statSync(secretsFile);
  if (!file.isFile())
    throw new Error("staging secrets path must be a regular file");
  if (process.platform !== "win32" && (file.mode & 0o077) !== 0) {
    throw new Error("staging secrets file must be private (chmod 600)");
  }

  validateStagingApiDryRuns(dryRun("staging"), dryRun());
  const result = spawnSync(
    process.execPath,
    [
      wrangler,
      "deploy",
      "--config",
      "wrangler.jsonc",
      "--env",
      "staging",
      "--secrets-file",
      secretsFile,
    ],
    { cwd: apiDirectory, stdio: "inherit" },
  );
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    deploy();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
