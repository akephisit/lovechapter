import console from "node:console";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { runLiveRelease } from "./live-release.mjs";

const shaPattern = /^[0-9a-f]{40}$/u;

/** Check workflow context before any credential or release adapter is loaded. */
export async function runReleaseCli(
  args,
  env,
  { driverFactory = runLiveRelease } = {},
) {
  const environment = args[0];
  const sha = env.GITHUB_SHA;
  if (
    args.length !== 1 ||
    !["staging", "production"].includes(environment) ||
    env.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_EVENT_NAME !== "push" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_REF_PROTECTED !== "true" ||
    env.GITHUB_REPOSITORY !== "akephisit/lovechapter" ||
    !shaPattern.test(sha ?? "") ||
    env.RELEASE_ENVIRONMENT !== environment
  ) {
    throw new Error(
      "Release invocation is not an exact-SHA protected main push",
    );
  }
  if (environment === "staging" && env.STAGING_RELEASE_ENABLED !== "true") {
    throw new Error("Automatic staging release is disabled");
  }
  if (environment === "production") {
    if (env.PRODUCTION_RELEASE_ENABLED !== "true") {
      throw new Error("Automatic production release is disabled");
    }
    if (env.RELEASE_STAGING_SHA !== sha) {
      throw new Error("Exact-SHA staging acceptance is absent");
    }
  }
  return driverFactory({ environment, sha }, env);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await runReleaseCli(process.argv.slice(2), process.env);
  } catch {
    // Credentials and provider output must never appear in Actions logs.
    console.error("worker_release_not_accepted");
    process.exitCode = 1;
  }
}
