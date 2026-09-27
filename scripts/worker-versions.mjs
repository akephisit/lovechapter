import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiDirectory = resolve(root, "apps/api");
const webDirectory = resolve(root, "apps/web");
const wrangler = resolve(root, "node_modules/wrangler/bin/wrangler.js");
const buildSentinels = {
  WEB_PROXY_SHARED_SECRET: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  RELEASE_PROBE_SECRET: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  API_UPSTREAM_ORIGIN: "https://release-build.invalid",
};

const shaPattern = /^[0-9a-f]{40}$/u;

function workerName(component, environment) {
  return `lovechapter-${component}${environment === "staging" ? "-staging" : ""}`;
}

function requireEnvironment(environment) {
  if (environment !== "staging" && environment !== "production") {
    throw new Error("Worker release environment must be staging or production");
  }
}

/** Fail closed on implicit Wrangler environment fallbacks or wrong bindings. */
export function validateWorkerConfigs(
  environment,
  apiConfig,
  webConfig,
  expectedHyperdriveId,
) {
  requireEnvironment(environment);
  if (
    !expectedHyperdriveId ||
    expectedHyperdriveId.startsWith("REPLACE_WITH_") ||
    apiConfig?.name !== "lovechapter-api" ||
    webConfig?.name !== "lovechapter-web" ||
    apiConfig.keep_vars !== true ||
    webConfig.keep_vars !== true ||
    apiConfig.preview_urls !== false ||
    webConfig.preview_urls !== false
  ) {
    throw new Error("Worker release configuration is incomplete");
  }
  const apiEnvironment =
    environment === "staging" ? apiConfig.env?.staging : apiConfig;
  const webEnvironment =
    environment === "staging" ? webConfig.env?.staging : webConfig;
  if (
    !apiEnvironment ||
    !webEnvironment ||
    apiEnvironment.preview_urls !== false ||
    webEnvironment.preview_urls !== false ||
    (environment === "staging" &&
      (apiEnvironment.workers_dev !== true ||
        webEnvironment.workers_dev !== true)) ||
    (apiEnvironment.name &&
      apiEnvironment.name !== workerName("api", environment)) ||
    (webEnvironment.name &&
      webEnvironment.name !== workerName("web", environment)) ||
    !Array.isArray(apiEnvironment.hyperdrive) ||
    apiEnvironment.hyperdrive.length !== 1 ||
    apiEnvironment.hyperdrive[0]?.binding !== "HYPERDRIVE" ||
    apiEnvironment.hyperdrive[0]?.id !== expectedHyperdriveId ||
    (environment === "staging" &&
      apiConfig.hyperdrive?.[0]?.id === expectedHyperdriveId)
  ) {
    throw new Error("Worker release target does not match expected bindings");
  }
  return {
    web: workerName("web", environment),
    api: workerName("api", environment),
  };
}

/** Inspect emitted assets, not just source, for build-time secret inlining. */
export function assertClientBundleClean(files, sentinels) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("Web build assets are unavailable for secret inspection");
  }
  for (const file of files) {
    for (const sentinel of sentinels) {
      if (sentinel && file.contents.includes(sentinel)) {
        throw new Error("Web build contains an inlined secret sentinel");
      }
    }
  }
}

function activeVersion(deployment, expectedName) {
  if (
    deployment?.workerName !== expectedName ||
    !Array.isArray(deployment.versions) ||
    deployment.versions.length !== 1 ||
    deployment.versions[0]?.percentage !== 100 ||
    typeof deployment.versions[0]?.version_id !== "string" ||
    !deployment.versions[0].version_id
  ) {
    throw new Error("Worker is not deployed as one expected version at 100%");
  }
  return deployment.versions[0].version_id;
}

/** All build and upload work happens before the cutover runner closes ingress. */
export async function prepareWorkerVersions(input, runner) {
  const { environment, impact, sha, previous, hyperdriveId } = input;
  requireEnvironment(environment);
  if (
    !shaPattern.test(sha ?? "") ||
    typeof impact?.web !== "boolean" ||
    typeof impact?.backend !== "boolean" ||
    (!impact.web && !impact.backend) ||
    (!previous && (!impact.web || !impact.backend))
  ) {
    throw new Error("Worker release preparation is incomplete");
  }
  const names = await runner.validateTarget(environment, hyperdriveId);
  if (
    names?.web !== workerName("web", environment) ||
    names?.api !== workerName("api", environment)
  ) {
    throw new Error("Worker names do not match the selected environment");
  }
  for (const component of ["web", "api"]) {
    const previewSettings = await runner.readPreviewSettings(
      component,
      environment,
    );
    if (previewSettings?.previewsEnabled !== false) {
      throw new Error(
        "Worker Version URLs must be disabled before preparation",
      );
    }
    const active = activeVersion(
      await runner.readDeployment(component, environment),
      names[component],
    );
    if (previous && active !== previous[component]?.versionId) {
      throw new Error("Active Worker version differs from release baseline");
    }
  }
  let webUploadedVersionId;
  if (impact.web) {
    await runner.buildWeb(environment, sha);
    await runner.dryRunWeb(environment);
    await runner.scanWebClientBundle();
    webUploadedVersionId = await runner.uploadWeb(environment, sha);
    if (!webUploadedVersionId) {
      throw new Error("Web version upload did not return a version ID");
    }
  }
  let apiUploadedVersionId;
  if (impact.backend) {
    await runner.buildApi(environment, sha);
    await runner.dryRunApi(environment);
    apiUploadedVersionId = await runner.uploadApi(environment, sha);
    if (!apiUploadedVersionId) {
      throw new Error("API version upload did not return a version ID");
    }
  }
  return {
    environment,
    sha,
    impact: { web: impact.web, backend: impact.backend },
    previous,
    names,
    hyperdriveId,
    webBuilt: impact.web,
    ...(webUploadedVersionId ? { webUploadedVersionId } : {}),
    ...(apiUploadedVersionId ? { apiUploadedVersionId } : {}),
  };
}

/** Called only after whole-site maintenance is closed and leases are drained. */
export async function deployPreparedVersions(prepared, runner) {
  if (
    !shaPattern.test(prepared?.sha ?? "") ||
    (prepared.impact?.web &&
      (!prepared.webBuilt || !prepared.webUploadedVersionId)) ||
    (prepared.impact?.backend && !prepared.apiUploadedVersionId)
  ) {
    throw new Error("Worker deployment has no complete prepared artifacts");
  }
  if (prepared.impact.web) {
    await runner.promoteWeb(
      prepared.environment,
      prepared.names.web,
      prepared.webUploadedVersionId,
    );
  }
  if (prepared.impact.backend) {
    await runner.promoteApi(
      prepared.environment,
      prepared.names.api,
      prepared.apiUploadedVersionId,
    );
  }
  const deployed = {};
  for (const component of ["web", "api"]) {
    const versionId = activeVersion(
      await runner.readDeployment(component, prepared.environment),
      prepared.names[component],
    );
    if (prepared.impact[component === "web" ? "web" : "backend"]) {
      if (
        versionId === prepared.previous?.[component]?.versionId ||
        (component === "api" && versionId !== prepared.apiUploadedVersionId) ||
        (component === "web" && versionId !== prepared.webUploadedVersionId)
      ) {
        throw new Error(
          "Changed Worker deployment did not reach the prepared version",
        );
      }
      deployed[component] = { versionId, sourceSha: prepared.sha };
    } else {
      if (versionId !== prepared.previous?.[component]?.versionId) {
        throw new Error("Unchanged Worker version drifted during release");
      }
      deployed[component] = prepared.previous[component];
    }
  }
  return deployed;
}

async function runCommand(executable, args, options) {
  try {
    return await execFileAsync(executable, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    if (options.failureKind === "web-promotion") {
      throw new Error(
        `Web promotion failed: ${classifyWebPromotionFailure(error)}`,
        { cause: error },
      );
    }
    // Child output can include provider details; never surface it in release logs.
    throw new Error("Worker preparation/deployment command failed", {
      cause: error,
    });
  }
}

/** Report only a fixed class of failure, never the child process output. */
export function classifyWebPromotionFailure(error) {
  const output = `${String(error?.stderr ?? "")}\n${String(error?.stdout ?? "")}`;
  if (
    /permission|unauthori[sz]ed|authentication|api token|forbidden/iu.test(
      output,
    )
  ) {
    return "authorization";
  }
  if (/workers\.dev|subdomain|route|trigger|custom domain/iu.test(output)) {
    return "route";
  }
  if (/asset|static content/iu.test(output)) return "assets";
  if (/binding|hyperdrive|secret/iu.test(output)) return "binding";
  if (/conflict|remote configuration|strict/iu.test(output)) {
    return "configuration conflict";
  }
  if (
    /unknown argument|unexpected argument|unrecognized option/iu.test(output)
  ) {
    return "argument";
  }
  if (/timeout|timed out|fetch failed|network/iu.test(output)) {
    return "network";
  }
  return "unknown";
}

async function readJsonc(path) {
  const { config, error } = ts.parseConfigFileTextToJson(
    path,
    await readFile(path, "utf8"),
  );
  if (error || !config) throw new Error("Wrangler configuration is invalid");
  return config;
}

async function emittedFiles(directory, relative = "") {
  const files = [];
  for (const entry of await readdir(resolve(directory, relative), {
    withFileTypes: true,
  })) {
    const path = join(relative, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await emittedFiles(directory, path)));
    } else if (entry.isFile()) {
      files.push({
        path,
        contents: await readFile(resolve(directory, path), "utf8"),
      });
    }
  }
  return files;
}

/** Only a fixed category and numeric provider code may reach release logs. */
export function classifyUploadFailure(event) {
  if (event?.type !== "command-failed") return "unknown";
  const message = String(event.message ?? "");
  const category = /permission|unauthori[sz]ed|authentication|api token/iu.test(
    message,
  )
    ? "authorization"
    : /strict|inherit|remote binding/iu.test(message)
      ? "strict bindings"
      : /hyperdrive|binding/iu.test(message)
        ? "binding"
        : /size|limit|exceed/iu.test(message)
          ? "limit"
          : "unknown";
  const code = event.code;
  return Number.isSafeInteger(code) && code >= 1000 && code <= 999999
    ? `${category} (code ${code})`
    : category;
}

async function readWranglerEvents(path) {
  try {
    return (await readFile(path, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function uploadVersion(environment, name, sha, component) {
  const isWeb = component === "web";
  const directory = isWeb ? webDirectory : apiDirectory;
  const config = isWeb ? "dist/server/wrangler.json" : "wrangler.jsonc";
  const label = isWeb ? "Web" : "API";
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "lc-wrangler-output-"),
  );
  const outputPath = join(temporaryDirectory, "upload.ndjson");
  try {
    try {
      await runCommand(
        process.execPath,
        [
          wrangler,
          "versions",
          "upload",
          "--config",
          config,
          ...(environment === "staging" ? ["--env", "staging"] : []),
          "--name",
          name,
          "--keep-vars",
          "--strict",
          "--tag",
          sha,
        ],
        {
          cwd: directory,
          env: { ...process.env, WRANGLER_OUTPUT_FILE_PATH: outputPath },
        },
      );
    } catch {
      const failure = (await readWranglerEvents(outputPath)).find(
        (event) => event.type === "command-failed",
      );
      throw new Error(
        `${label} upload failed: ${classifyUploadFailure(failure)}`,
      );
    }
    const events = await readWranglerEvents(outputPath);
    const upload = events.find((event) => event.type === "version-upload");
    if (
      upload?.worker_name !== name ||
      typeof upload.version_id !== "string" ||
      !upload.version_id
    ) {
      throw new Error(`${label} upload receipt does not match Worker name`);
    }
    return upload.version_id;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

export function createWorkerCommandRunner({
  cloudflareAccountId,
  cloudflareApiToken,
  fetcher = globalThis.fetch,
}) {
  if (!cloudflareAccountId || !cloudflareApiToken) {
    throw new Error("Cloudflare release credentials are required");
  }
  return {
    async validateTarget(environment, hyperdriveId) {
      const [api, web] = await Promise.all([
        readJsonc(resolve(apiDirectory, "wrangler.jsonc")),
        readJsonc(resolve(webDirectory, "wrangler.jsonc")),
      ]);
      return validateWorkerConfigs(environment, api, web, hyperdriveId);
    },
    async readDeployment(component, environment) {
      const name = workerName(component, environment);
      const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cloudflareAccountId)}/workers/scripts/${encodeURIComponent(name)}/deployments`;
      let response;
      try {
        response = await fetcher(url, {
          headers: { Authorization: `Bearer ${cloudflareApiToken}` },
        });
        if (!response.ok) throw new Error("provider error");
        const body = await response.json();
        if (body.success !== true || !Array.isArray(body.result?.deployments)) {
          throw new Error("provider response error");
        }
        const latest = [...body.result.deployments].sort(
          (left, right) =>
            Date.parse(right.created_on) - Date.parse(left.created_on),
        )[0];
        if (!latest || !Array.isArray(latest.versions)) {
          throw new Error("missing deployment");
        }
        return {
          workerName: name,
          versions: latest.versions.map((version) => ({
            version_id: version.version_id,
            percentage: version.percentage,
          })),
        };
      } catch {
        throw new Error("Cloudflare Worker deployment inventory unavailable");
      }
    },
    async readPreviewSettings(component, environment) {
      const name = workerName(component, environment);
      const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(cloudflareAccountId)}/workers/scripts/${encodeURIComponent(name)}/subdomain`;
      try {
        const response = await fetcher(url, {
          headers: { Authorization: `Bearer ${cloudflareApiToken}` },
        });
        if (!response.ok) throw new Error("provider error");
        const body = await response.json();
        if (
          body.success !== true ||
          typeof body.result?.previews_enabled !== "boolean"
        ) {
          throw new Error("provider response error");
        }
        return { previewsEnabled: body.result.previews_enabled };
      } catch {
        throw new Error("Cloudflare Version URL setting is unavailable");
      }
    },
    async buildWeb() {
      await runCommand(
        "npm",
        ["run", "build", "--workspace", "@lovechapter/web"],
        {
          cwd: root,
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            CI: process.env.CI,
            NODE_ENV: "production",
            ...buildSentinels,
          },
        },
      );
    },
    async dryRunWeb(environment) {
      await runCommand(
        process.execPath,
        [
          wrangler,
          "versions",
          "upload",
          "--config",
          "dist/server/wrangler.json",
          ...(environment === "staging" ? ["--env", "staging"] : []),
          "--name",
          workerName("web", environment),
          "--keep-vars",
          "--strict",
          "--dry-run",
        ],
        { cwd: webDirectory },
      );
    },
    async scanWebClientBundle() {
      const files = await emittedFiles(resolve(webDirectory, "dist"));
      if (
        !files.some(
          (file) =>
            file.path.startsWith("client/") && file.path.endsWith(".js"),
        )
      ) {
        throw new Error("Web client JavaScript is unavailable for inspection");
      }
      assertClientBundleClean(files, Object.values(buildSentinels));
    },
    async buildApi(environment) {
      await runCommand(
        "npm",
        [
          "run",
          environment === "staging" ? "build:worker:staging" : "build:worker",
          "--workspace",
          "@lovechapter/api",
        ],
        { cwd: root },
      );
    },
    async dryRunApi(environment) {
      await runCommand(
        process.execPath,
        [
          wrangler,
          "versions",
          "upload",
          "--dry-run",
          "--config",
          "wrangler.jsonc",
          ...(environment === "staging" ? ["--env", "staging"] : []),
          "--name",
          workerName("api", environment),
          "--keep-vars",
          "--strict",
        ],
        { cwd: apiDirectory },
      );
    },
    async uploadApi(environment, sha) {
      return uploadVersion(
        environment,
        workerName("api", environment),
        sha,
        "api",
      );
    },
    async uploadWeb(environment, sha) {
      return uploadVersion(
        environment,
        workerName("web", environment),
        sha,
        "web",
      );
    },
    async promoteWeb(environment, name, versionId) {
      await runCommand(
        process.execPath,
        [
          wrangler,
          "versions",
          "deploy",
          `${versionId}@100%`,
          "--config",
          "dist/server/wrangler.json",
          ...(environment === "staging" ? ["--env", "staging"] : []),
          "--name",
          name,
          "--yes",
        ],
        { cwd: webDirectory, failureKind: "web-promotion" },
      );
    },
    async promoteApi(environment, name, versionId) {
      await runCommand(
        process.execPath,
        [
          wrangler,
          "versions",
          "deploy",
          `${versionId}@100%`,
          "--config",
          "wrangler.jsonc",
          ...(environment === "staging" ? ["--env", "staging"] : []),
          "--name",
          name,
          "--yes",
        ],
        { cwd: apiDirectory },
      );
    },
  };
}
