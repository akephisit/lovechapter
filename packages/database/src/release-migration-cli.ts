import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

import { migrationFolder, pendingMigrations } from "./migration-history";
import { releaseTargetFromEnvironment } from "./release-gate-cli";
import { PostgresReleaseGateController } from "./release-gate-repository";
import {
  loadReleaseInventory,
  validateDirectDatabaseUrl,
  verifyReleaseTarget,
} from "./release-target";
import { expectedSchemaMigrationHash } from "./schema-revision";

type Environment = Record<string, string | undefined>;
type Options = {
  createClient?: (connectionString: string) => Client;
  migrateDatabase?: (client: Client) => Promise<void>;
  fetcher?: typeof fetch;
  write?: (line: string) => void;
};

const shaPattern = /^[0-9a-f]{40}$/;

function required(environment: Environment, name: string): string {
  const value = environment[name];
  if (!value || !value.trim() || /^REPLACE_WITH_/iu.test(value)) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseArgs(args: string[]) {
  if (
    args.length < 6 ||
    args.length % 2 !== 0 ||
    args[0] !== "--sha" ||
    args[2] !== "--closed-at" ||
    !shaPattern.test(args[1] ?? "") ||
    !Number.isFinite(Date.parse(args[3] ?? ""))
  ) {
    throw new Error("Release migration arguments are invalid");
  }
  const reviewed: string[] = [];
  for (let index = 4; index < args.length; index += 2) {
    const path = args[index + 1];
    if (
      args[index] !== "--reviewed" ||
      !path ||
      !/^packages\/database\/drizzle\/[A-Za-z0-9_-]+\.sql$/u.test(path) ||
      reviewed.includes(path)
    ) {
      throw new Error("Release migration arguments are invalid");
    }
    reviewed.push(path);
  }
  return { sha: args[1]!, closedAt: args[3]!, reviewed };
}

async function assertExactPending(client: Client, reviewed: string[]) {
  const pending = await pendingMigrations(client);
  if (
    pending.length !== reviewed.length ||
    pending.some((path) => !reviewed.includes(path))
  ) {
    throw new Error("Pending migrations differ from reviewed release plan");
  }
}

async function assertDrainedClosure(
  client: Client,
  sha: string,
  closedAt: string,
) {
  const status = await new PostgresReleaseGateController(client).status();
  if (
    status.mode !== "maintenance" ||
    status.targetSha !== sha ||
    status.changedAt !== closedAt ||
    status.activeCount !== 0
  ) {
    throw new Error("Release gate is not drained for this closure");
  }
}

async function migrateCheckedIn(client: Client) {
  await migrate(drizzle({ client }), { migrationsFolder: migrationFolder });
}

/** Run only the reviewed pending SQL against a provider-verified, closed target. */
export async function runReleaseMigrationCli(
  args: string[],
  environment: Environment,
  options: Options = {},
): Promise<void> {
  try {
    const { sha, closedAt, reviewed } = parseArgs(args);
    const gateTarget = releaseTargetFromEnvironment(environment);
    const target = {
      ...gateTarget,
      role: required(environment, "RELEASE_MIGRATION_DATABASE_ROLE"),
      directUrl: required(environment, "RELEASE_MIGRATION_DATABASE_URL"),
    };
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
    const createClient =
      options.createClient ??
      ((connectionString: string) =>
        new Client({ connectionString, connectionTimeoutMillis: 5_000 }));
    const client = createClient(target.directUrl);
    try {
      await client.connect();
      await assertDrainedClosure(client, sha, closedAt);
      await assertExactPending(client, reviewed);
      await (options.migrateDatabase ?? migrateCheckedIn)(client);
      const revision = await client.query<{ one: number }>(
        `select 1 as one from drizzle.__drizzle_migrations
         where id = (select max(id) from drizzle.__drizzle_migrations)
           and hash = $1`,
        [expectedSchemaMigrationHash],
      );
      if (revision.rows.length !== 1 || revision.rows[0]?.one !== 1) {
        throw new Error("Deployed schema revision does not match");
      }
      await assertDrainedClosure(client, sha, closedAt);
    } finally {
      await client.end();
    }
    (options.write ?? console.log)(
      JSON.stringify({ status: "applied_and_validated" }),
    );
  } catch {
    throw new Error("Release migration failed");
  }
}

if (import.meta.main) {
  try {
    await runReleaseMigrationCli(process.argv.slice(2), process.env);
  } catch {
    console.error("release_migration_failed");
    process.exitCode = 1;
  }
}
