import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

import { migrationFolder } from "./migration-history";
import { releaseTargetFromEnvironment } from "./release-gate-cli";
import { PostgresReleaseGateController } from "./release-gate-repository";
import {
  loadReleaseInventory,
  validateDirectDatabaseUrl,
  verifyReleaseTarget,
} from "./release-target";
import { expectedSchemaMigrationHash } from "./schema-revision";
import { PostgresStagingBootstrapGate } from "./staging-bootstrap-gate";
import { assertStagingBootstrapSchema } from "./staging-bootstrap-schema";

type Environment = Record<string, string | undefined>;
type Options = {
  createClient?: (connectionString: string) => Client;
  migrateDatabase?: (client: Client) => Promise<void>;
  fetcher?: typeof fetch;
  write?: (line: string) => void;
};
type Arguments = {
  sha: string;
  closedAt: string;
  checkpointBranchId: string;
  checkpointLsn: string;
};
export type RetainedMarkers = {
  users: number;
  weddings: number;
  guests: number;
  invitations: number;
  rsvps: number;
  authAccounts: number;
  authEmailJobs: number;
};

const shaPattern = /^[0-9a-f]{40}$/u;
const branchPattern = /^br-[a-z0-9-]{1,57}$/u;
const lsnPattern = /^[0-9A-F]+\/[0-9A-F]+$/u;
const markerKeys = [
  "users",
  "weddings",
  "guests",
  "invitations",
  "rsvps",
  "authAccounts",
  "authEmailJobs",
] as const;

function required(environment: Environment, name: string): string {
  const value = environment[name];
  if (!value || !value.trim() || /^REPLACE_WITH_/iu.test(value)) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseArgs(args: string[]): Arguments {
  if (
    args.length !== 8 ||
    args[0] !== "--sha" ||
    args[2] !== "--closed-at" ||
    args[4] !== "--checkpoint-branch-id" ||
    args[6] !== "--checkpoint-lsn" ||
    !shaPattern.test(args[1] ?? "") ||
    !Number.isFinite(Date.parse(args[3] ?? "")) ||
    !branchPattern.test(args[5] ?? "") ||
    !lsnPattern.test(args[7] ?? "")
  ) {
    throw new Error("Invalid staging bootstrap migration arguments");
  }
  return {
    sha: args[1]!,
    closedAt: args[3]!,
    checkpointBranchId: args[5]!,
    checkpointLsn: args[7]!,
  };
}

async function providerJson(fetcher: typeof fetch, url: string, key: string) {
  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!response.ok) throw new Error("Checkpoint provider unavailable");
  return (await response.json()) as unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function verifyCheckpointProvider(
  args: Arguments,
  environment: Environment,
  checkpointUrl: URL,
  fetcher: typeof fetch,
): Promise<void> {
  const projectId = encodeURIComponent(
    required(environment, "RELEASE_NEON_PROJECT_ID"),
  );
  const branchId = encodeURIComponent(args.checkpointBranchId);
  const base = `https://console.neon.tech/api/v2/projects/${projectId}/branches/${branchId}`;
  const key = required(environment, "RELEASE_NEON_API_KEY");
  const branch = record(record(await providerJson(fetcher, base, key))?.branch);
  if (
    branch?.id !== args.checkpointBranchId ||
    branch.project_id !== environment.RELEASE_NEON_PROJECT_ID ||
    branch.parent_id !== environment.RELEASE_NEON_BRANCH_ID ||
    branch.parent_lsn !== args.checkpointLsn ||
    branch.init_source !== "parent-data"
  ) {
    throw new Error("Checkpoint provenance mismatch");
  }
  const endpoints = record(
    await providerJson(fetcher, `${base}/endpoints`, key),
  )?.endpoints;
  if (
    !Array.isArray(endpoints) ||
    endpoints.filter((candidate) => {
      const endpoint = record(candidate);
      return (
        endpoint?.branch_id === args.checkpointBranchId &&
        endpoint.host === checkpointUrl.hostname &&
        endpoint.type === "read_write"
      );
    }).length !== 1
  ) {
    throw new Error("Checkpoint endpoint mismatch");
  }
}

function createDefaultClient(url: string): Client {
  return new Client({
    connectionString: url,
    connectionTimeoutMillis: 5_000,
    query_timeout: 10_000,
  });
}

async function readMarkers(client: Client): Promise<RetainedMarkers> {
  const result = await client.query<Record<string, string>>(
    `select
       (select count(*)::text from users) as "users",
       (select count(*)::text from weddings) as "weddings",
       (select count(*)::text from guests) as "guests",
       (select count(*)::text from invitations) as "invitations",
       (select count(*)::text from rsvps) as "rsvps",
       (select count(*)::text from auth_accounts) as "authAccounts",
       (select count(*)::text from auth_email_jobs) as "authEmailJobs"`,
  );
  const row = result.rows[0];
  if (result.rows.length !== 1 || !row) {
    throw new Error("Retained row markers unavailable");
  }
  const parsed = Object.fromEntries(
    markerKeys.map((key) => [key, Number(row[key])]),
  ) as RetainedMarkers;
  if (
    markerKeys.some(
      (key) => !Number.isSafeInteger(parsed[key]) || parsed[key] < 0,
    )
  ) {
    throw new Error("Retained row markers invalid");
  }
  return parsed;
}

function sameMarkers(left: RetainedMarkers, right: RetainedMarkers): boolean {
  return markerKeys.every((key) => left[key] === right[key]);
}

async function assertPreSchemaClosure(
  client: Client,
  args: Arguments,
): Promise<void> {
  await assertStagingBootstrapSchema(client);
  const gate = await new PostgresStagingBootstrapGate(client).status();
  if (
    gate.mode !== "maintenance" ||
    gate.targetSha !== args.sha ||
    gate.changedAt !== args.closedAt ||
    gate.activeCount !== 0
  ) {
    throw new Error("Staging closure is not drained");
  }
}

async function assertCurrentSchema(
  client: Client,
  args: Arguments,
): Promise<void> {
  const columns = await client.query<{ column_name: string }>(
    `select column_name from information_schema.columns
     where table_schema = 'ops' and table_name = 'release_control'
       and column_name in ('web_version_id', 'web_source_sha', 'api_version_id', 'api_source_sha')`,
  );
  const names = new Set(columns.rows.map((row) => row.column_name));
  if (
    names.size !== 4 ||
    [
      "web_version_id",
      "web_source_sha",
      "api_version_id",
      "api_source_sha",
    ].some((name) => !names.has(name))
  ) {
    throw new Error("Current release columns missing");
  }
  const constraint = await client.query<{ one: number }>(
    `select 1 as one from pg_constraint
     where conname = 'release_control_versions_chk'
       and conrelid = 'ops.release_control'::regclass`,
  );
  if (constraint.rows.length !== 1 || constraint.rows[0]?.one !== 1) {
    throw new Error("Release version constraint missing");
  }
  const revision = await client.query<{ one: number }>(
    `select 1 as one from drizzle.__drizzle_migrations
     where id = (select max(id) from drizzle.__drizzle_migrations)
       and hash = $1`,
    [expectedSchemaMigrationHash],
  );
  if (revision.rows.length !== 1 || revision.rows[0]?.one !== 1) {
    throw new Error("Current migration hash mismatch");
  }
  const gate = await new PostgresReleaseGateController(client).status();
  if (
    gate.mode !== "maintenance" ||
    gate.targetSha !== args.sha ||
    gate.changedAt !== args.closedAt ||
    gate.activeCount !== 0
  ) {
    throw new Error("Staging closure changed during migration");
  }
}

async function migrateCheckedIn(client: Client): Promise<void> {
  await migrate(drizzle({ client }), { migrationsFolder: migrationFolder });
}

/** Applies only 0011 after a verified, readable post-drain Neon checkpoint. */
export async function runStagingBootstrapMigrationCli(
  rawArgs: string[],
  environment: Environment,
  options: Options = {},
): Promise<void> {
  try {
    const args = parseArgs(rawArgs);
    if (environment.RELEASE_ENVIRONMENT !== "staging") {
      throw new Error("Only staging is permitted");
    }
    const gateTarget = releaseTargetFromEnvironment(environment);
    validateDirectDatabaseUrl(gateTarget.directUrl);
    const migrationRole = required(
      environment,
      "RELEASE_MIGRATION_DATABASE_ROLE",
    );
    if (
      migrationRole === gateTarget.role ||
      migrationRole === gateTarget.appRole
    ) {
      throw new Error("Migration role must be distinct");
    }
    const target = {
      ...gateTarget,
      role: migrationRole,
      directUrl: required(environment, "RELEASE_MIGRATION_DATABASE_URL"),
    };
    validateDirectDatabaseUrl(target.directUrl);
    const checkpointUrlValue = required(
      environment,
      "RELEASE_CHECKPOINT_DATABASE_URL",
    );
    const checkpointUrl = validateDirectDatabaseUrl(checkpointUrlValue);
    if (
      decodeURIComponent(checkpointUrl.username) !==
        required(environment, "RELEASE_CHECKPOINT_DATABASE_ROLE") ||
      decodeURIComponent(checkpointUrl.pathname.slice(1)) !== target.database
    ) {
      throw new Error("Checkpoint connection identity mismatch");
    }
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
    verifyReleaseTarget(gateTarget, inventory);
    verifyReleaseTarget(target, inventory);
    await verifyCheckpointProvider(
      args,
      environment,
      checkpointUrl,
      options.fetcher ?? fetch,
    );
    const createClient = options.createClient ?? createDefaultClient;
    const checkpoint = createClient(checkpointUrlValue);
    let checkpointMarkers: RetainedMarkers;
    try {
      await checkpoint.connect();
      await assertPreSchemaClosure(checkpoint, args);
      checkpointMarkers = await readMarkers(checkpoint);
    } finally {
      await checkpoint.end();
    }
    const client = createClient(target.directUrl);
    try {
      await client.connect();
      await assertPreSchemaClosure(client, args);
      const before = await readMarkers(client);
      if (!sameMarkers(before, checkpointMarkers)) {
        throw new Error(
          "Checkpoint retained markers differ from active staging",
        );
      }
      await (options.migrateDatabase ?? migrateCheckedIn)(client);
      await assertCurrentSchema(client, args);
      const after = await readMarkers(client);
      if (!sameMarkers(before, after)) {
        throw new Error("Migration altered retained application rows");
      }
    } finally {
      await client.end();
    }
    (options.write ?? console.log)(
      JSON.stringify({
        status: "applied_and_validated",
        checkpointBranchId: args.checkpointBranchId,
      }),
    );
  } catch {
    throw new Error("Staging bootstrap migration failed");
  }
}

if (import.meta.main) {
  try {
    await runStagingBootstrapMigrationCli(process.argv.slice(2), process.env);
  } catch {
    console.error("staging_bootstrap_migration_failed");
    process.exitCode = 1;
  }
}
