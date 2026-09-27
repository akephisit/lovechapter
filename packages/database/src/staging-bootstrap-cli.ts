import { Client } from "pg";

import { releaseTargetFromEnvironment } from "./release-gate-cli";
import {
  loadReleaseInventory,
  validateDirectDatabaseUrl,
  verifyReleaseTarget,
} from "./release-target";
import { PostgresStagingBootstrapGate } from "./staging-bootstrap-gate";
import { assertStagingBootstrapSchema } from "./staging-bootstrap-schema";

type Environment = Record<string, string | undefined>;
type Command =
  | { name: "status" }
  | { name: "close"; sha: string }
  | { name: "drain"; sha: string; closedAt: string };
type Options = {
  createClient?: (connectionString: string) => Client;
  fetcher?: typeof fetch;
  write?: (line: string) => void;
  signal?: AbortSignal;
  now?: () => number;
  drainTimeoutMs?: number;
};

const shaPattern = /^[0-9a-f]{40}$/u;

function required(environment: Environment, name: string): string {
  const value = environment[name];
  if (!value || !value.trim() || /^REPLACE_WITH_/iu.test(value)) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseCommand(args: string[]): Command {
  if (args.length === 1 && args[0] === "status") return { name: "status" };
  if (args.length === 3 && args[0] === "close" && args[1] === "--sha") {
    if (!shaPattern.test(args[2] ?? "")) throw new Error("Invalid SHA");
    return { name: "close", sha: args[2]! };
  }
  if (
    args.length === 5 &&
    args[0] === "drain" &&
    args[1] === "--sha" &&
    args[3] === "--closed-at" &&
    shaPattern.test(args[2] ?? "") &&
    Number.isFinite(Date.parse(args[4] ?? ""))
  ) {
    return { name: "drain", sha: args[2]!, closedAt: args[4]! };
  }
  throw new Error("Invalid staging bootstrap gate arguments");
}

/** Pre-0011 staging command; deliberately cannot reopen a gate. */
export async function runStagingBootstrapGateCli(
  args: string[],
  environment: Environment,
  options: Options = {},
): Promise<void> {
  try {
    const command = parseCommand(args);
    if (environment.RELEASE_ENVIRONMENT !== "staging") {
      throw new Error("Only staging is permitted");
    }
    const target = releaseTargetFromEnvironment(environment);
    validateDirectDatabaseUrl(target.directUrl);
    const inventory = await loadReleaseInventory(
      target,
      {
        neonApiKey: required(environment, "RELEASE_NEON_API_KEY"),
        cloudflareApiToken: required(
          environment,
          "RELEASE_CLOUDFLARE_API_TOKEN",
        ),
      },
      options.fetcher,
    );
    verifyReleaseTarget(target, inventory);
    const client = (
      options.createClient ??
      ((url: string) =>
        new Client({
          connectionString: url,
          connectionTimeoutMillis: 5_000,
          query_timeout: 10_000,
        }))
    )(target.directUrl);
    try {
      await client.connect();
      await assertStagingBootstrapSchema(client);
      const gate = new PostgresStagingBootstrapGate(client);
      const status =
        command.name === "status"
          ? await gate.status()
          : command.name === "close"
            ? await gate.closeOnce(command.sha)
            : await gate.drain(command.sha, command.closedAt, {
                deadlineMs: deadline(options),
                ...(options.signal ? { signal: options.signal } : {}),
              });
      (options.write ?? console.log)(JSON.stringify(status));
    } finally {
      await client.end();
    }
  } catch {
    throw new Error("Staging bootstrap gate failed");
  }
}

function deadline(options: Options): number {
  const timeout = options.drainTimeoutMs ?? 10 * 60_000;
  const now = (options.now ?? Date.now)();
  if (
    !Number.isSafeInteger(timeout) ||
    timeout < 1 ||
    !Number.isSafeInteger(now)
  ) {
    throw new Error("Invalid drain deadline");
  }
  return now + timeout;
}

if (import.meta.main) {
  try {
    await runStagingBootstrapGateCli(process.argv.slice(2), process.env);
  } catch {
    console.error("staging_bootstrap_gate_failed");
    process.exitCode = 1;
  }
}
