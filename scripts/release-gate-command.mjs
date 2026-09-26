import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const gateCliPath = resolve(root, "packages/database/src/release-gate-cli.ts");
const shaPattern = /^[0-9a-f]{40}$/u;

async function defaultRunFile(executable, args, options) {
  return execFileAsync(executable, args, options);
}

function assertSha(sha) {
  if (!shaPattern.test(sha ?? "")) {
    throw new Error("Release gate requires a full SHA");
  }
}

function parseStatus(stdout) {
  let state;
  try {
    state = JSON.parse(String(stdout).trim());
  } catch {
    throw new Error("Release gate status is invalid");
  }
  if (
    !["open", "maintenance"].includes(state?.mode) ||
    (state.targetSha !== null && !shaPattern.test(state.targetSha ?? "")) ||
    !Number.isFinite(Date.parse(state.changedAt ?? "")) ||
    !Number.isSafeInteger(state.activeCount) ||
    state.activeCount < 0 ||
    !["web", "api"].every(
      (component) =>
        state[component] === null ||
        (typeof state[component]?.versionId === "string" &&
          state[component].versionId.length > 0 &&
          shaPattern.test(state[component].sourceSha ?? "")),
    )
  ) {
    throw new Error("Release gate status is invalid");
  }
  return state;
}

/** Invoke the target-verified, direct-Postgres gate CLI without logging credentials. */
export function createReleaseGateCommand({ env, runFile = defaultRunFile }) {
  if (
    !["staging", "production"].includes(env?.RELEASE_ENVIRONMENT) ||
    typeof runFile !== "function"
  ) {
    throw new Error("Release gate environment is invalid");
  }
  async function command(args, timeout = 60_000) {
    try {
      return await runFile("bun", [gateCliPath, ...args], {
        cwd: root,
        env,
        timeout,
        maxBuffer: 64 * 1024,
      });
    } catch {
      throw new Error("Release gate command failed");
    }
  }
  async function status() {
    const result = await command(["status"]);
    return parseStatus(result.stdout);
  }
  async function close(sha) {
    assertSha(sha);
    await command(["close", "--sha", sha]);
    const state = await status();
    if (state.mode !== "maintenance" || state.targetSha !== sha) {
      throw new Error("Release gate did not close for this SHA");
    }
    return state;
  }
  async function drain(sha) {
    assertSha(sha);
    await command(["drain", "--sha", sha], 11 * 60_000);
    const state = await status();
    if (
      state.mode !== "maintenance" ||
      state.targetSha !== sha ||
      state.activeCount !== 0
    ) {
      throw new Error("Release gate did not drain for this SHA");
    }
    return state;
  }
  async function open(sha, evidence) {
    assertSha(sha);
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "lovechapter-release-"),
    );
    const evidencePath = join(temporaryDirectory, "evidence.json");
    try {
      await writeFile(evidencePath, JSON.stringify(evidence), { mode: 0o600 });
      await command(["open", "--sha", sha, "--evidence", evidencePath]);
      const state = await status();
      if (state.mode !== "open" || state.targetSha !== sha) {
        throw new Error("Release gate did not open for this SHA");
      }
      return state;
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }
  return { status, close, drain, open, reclose: close };
}
