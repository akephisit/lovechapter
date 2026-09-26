import { readFile } from "node:fs/promises";

import { Client } from "pg";

import { PostgresReleaseGateController } from "./release-gate-repository";

type Environment = Record<string, string | undefined>;
type Command =
  | { name: "status" }
  | { name: "close"; sha: string }
  | { name: "drain"; sha: string }
  | { name: "open"; sha: string; evidencePath: string };

type CliOptions = {
  createClient?: (connectionString: string) => Client;
  write?: (line: string) => void;
  readEvidence?: (path: string) => Promise<string>;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  now?: () => number;
  drainTimeoutMs?: number;
};

const shaPattern = /^[0-9a-f]{40}$/;

export async function runReleaseGateCli(
  args: string[],
  environment: Environment,
  options: CliOptions = {},
): Promise<void> {
  const command = parseCommand(args);
  if (environment.RELEASE_ENVIRONMENT !== "staging") {
    throw new Error("Only the staging release environment is enabled");
  }
  const connectionString = directDatabaseUrl(environment.RELEASE_DATABASE_URL);
  const createClient =
    options.createClient ??
    ((url: string) =>
      new Client({
        connectionString: url,
        connectionTimeoutMillis: 5_000,
        query_timeout: 10_000,
      }));
  const client = createClient(connectionString);
  try {
    await client.connect();
    const controller = new PostgresReleaseGateController(client);
    const write = options.write ?? console.log;
    if (command.name === "status") {
      const { mode, targetSha, activeCount } = await controller.status();
      write(JSON.stringify({ mode, targetSha, activeCount }));
      return;
    }
    if (command.name === "close") {
      await controller.closeFor(command.sha);
      write(JSON.stringify({ mode: "maintenance", targetSha: command.sha }));
      return;
    }
    if (command.name === "drain") {
      await drain(controller, command.sha, options);
      write(JSON.stringify({ mode: "maintenance", activeCount: 0 }));
      return;
    }
    const readEvidence =
      options.readEvidence ?? ((path: string) => readFile(path, "utf8"));
    const rawEvidence = await readEvidence(command.evidencePath);
    validateEvidence(rawEvidence, command.sha);
    const status = await controller.status();
    if (
      status.mode !== "maintenance" ||
      status.targetSha !== command.sha ||
      status.activeCount !== 0
    ) {
      throw new Error("Release target is not drained for this SHA");
    }
    if (!(await controller.openFor(command.sha))) {
      throw new Error("Release gate could not reopen atomically");
    }
    write(JSON.stringify({ mode: "open", targetSha: command.sha }));
  } finally {
    await client.end();
  }
}

function parseCommand(args: string[]): Command {
  const name = args[0];
  if (!["status", "close", "drain", "open"].includes(name ?? "")) {
    throw new Error("Unknown release gate command");
  }
  const flags = new Map<string, string>();
  for (let index = 1; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (
      !flag ||
      !value ||
      !["--sha", "--evidence"].includes(flag) ||
      flags.has(flag)
    ) {
      throw new Error("Invalid release gate arguments");
    }
    flags.set(flag, value);
  }
  if (name === "status") {
    if (flags.size !== 0) throw new Error("Status accepts no arguments");
    return { name };
  }
  const sha = flags.get("--sha");
  if (!sha || !shaPattern.test(sha)) {
    throw new Error("A full lowercase commit SHA is required");
  }
  if (name === "open") {
    const evidencePath = flags.get("--evidence");
    if (!evidencePath || flags.size !== 2) {
      throw new Error("Open requires one evidence file");
    }
    return { name, sha, evidencePath };
  }
  if (flags.size !== 1) {
    throw new Error("Unexpected release gate arguments");
  }
  return name === "close" ? { name, sha } : { name: "drain", sha };
}

function directDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error("RELEASE_DATABASE_URL is required");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("RELEASE_DATABASE_URL is invalid");
  }
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !url.password ||
    /(?:^|[-.])(?:pooler|pgbouncer)(?:[.-]|$)/iu.test(url.hostname) ||
    !["require", "verify-full"].includes(url.searchParams.get("sslmode") ?? "")
  ) {
    throw new Error("RELEASE_DATABASE_URL must be a direct TLS PostgreSQL URL");
  }
  return value;
}

async function drain(
  controller: PostgresReleaseGateController,
  sha: string,
  options: CliOptions,
): Promise<void> {
  const now = options.now ?? Date.now;
  const timeout = options.drainTimeoutMs ?? 10 * 60_000;
  if (!Number.isSafeInteger(timeout) || timeout < 1) {
    throw new Error("Drain timeout is invalid");
  }
  const deadline = now() + timeout;
  while (true) {
    if (options.signal?.aborted) throw new Error("Drain interrupted");
    const status = await controller.status();
    if (status.mode !== "maintenance" || status.targetSha !== sha) {
      throw new Error("Release gate is not closed for this SHA");
    }
    if (status.activeCount === 0) return;
    if (now() >= deadline)
      throw new Error("Drain timed out; gate remains closed");
    await (options.sleep ?? delay)(1_000, options.signal);
  }
}

function validateEvidence(raw: string, sha: string): void {
  let evidence: unknown;
  try {
    evidence = JSON.parse(raw);
  } catch {
    throw new Error("Release evidence is invalid JSON");
  }
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) {
    throw new Error("Release evidence is invalid");
  }
  const value = evidence as Record<string, unknown>;
  if (
    value.commitSha !== sha ||
    typeof value.apiWorkerVersion !== "string" ||
    !value.apiWorkerVersion.trim() ||
    typeof value.webWorkerVersion !== "string" ||
    !value.webWorkerVersion.trim() ||
    value.migrationChecked !== true ||
    value.privateSmokePassed !== true ||
    typeof value.acceptedAt !== "string" ||
    !isCanonicalTimestamp(value.acceptedAt)
  ) {
    throw new Error("Release evidence is incomplete or targets another SHA");
  }
}

function isCanonicalTimestamp(value: string): boolean {
  const timestamp = Date.parse(value);
  return (
    Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
  );
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Drain interrupted"));
      return;
    }
    const timeout = setTimeout(done, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timeout);
      reject(new Error("Drain interrupted"));
    }
  });
}

if (import.meta.main) {
  try {
    await runReleaseGateCli(process.argv.slice(2), process.env);
  } catch {
    console.error("release_gate_command_failed");
    process.exitCode = 1;
  }
}
