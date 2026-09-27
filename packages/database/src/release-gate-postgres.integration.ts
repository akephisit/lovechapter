import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import * as database from "./index";
import { createPostgresRuntime, type PostgresRuntime } from "./client";
import { PostgresStagingBootstrapGate } from "./staging-bootstrap-gate";
import { runStagingBootstrapMigrationCli } from "./staging-bootstrap-migration-cli";

const connectionString = process.env.TEST_DATABASE_URL;
const restrictedConnectionString = process.env.TEST_GATE_APP_DATABASE_URL;
if (
  !connectionString ||
  process.env.TEST_DATABASE_CONFIRM !== "lovechapter_test" ||
  connectionString === process.env.DATABASE_URL
) {
  throw new Error("Release gate integration requires a disposable database");
}
const disposableUrl = new URL(connectionString);
const localDisposable =
  ["127.0.0.1", "localhost"].includes(disposableUrl.hostname) &&
  disposableUrl.pathname === "/lovechapter_test";

type GateStore = {
  readMode(): Promise<"open" | "maintenance">;
  admit(kind: "http" | "email" | "cleanup"): Promise<string | null>;
  release(id: string): Promise<void>;
};

type GateController = {
  closeFor(sha: string): Promise<void>;
  activeCount(): Promise<number>;
  status(): Promise<{
    mode: "open" | "maintenance";
    targetSha: string | null;
    changedAt: string;
    web: { versionId: string; sourceSha: string } | null;
    api: { versionId: string; sourceSha: string } | null;
    activeCount: number;
    oldestLeases: { id: string; kind: string; startedAt: string }[];
  }>;
  openFor(
    sha: string,
    changedAt: string,
    versions: {
      web: { versionId: string; sourceSha: string };
      api: { versionId: string; sourceSha: string };
    },
  ): Promise<boolean>;
};

let runtime: PostgresRuntime;

beforeAll(async () => {
  const migrationPool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle({ client: migrationPool }), {
      migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
    });
    if (process.env.CI === "true" && restrictedConnectionString) {
      const target = new URL(connectionString);
      if (
        target.hostname !== "127.0.0.1" ||
        target.pathname !== "/lovechapter_test"
      ) {
        throw new Error(
          "CI restricted role requires local disposable PostgreSQL",
        );
      }
      await migrationPool.query(
        "CREATE ROLE lovechapter_gate_test_app LOGIN PASSWORD 'ci_only_disposable'",
      );
      await migrationPool.query(
        "GRANT USAGE ON SCHEMA ops TO lovechapter_gate_test_app",
      );
      await migrationPool.query(
        "GRANT SELECT ON ops.release_control TO lovechapter_gate_test_app",
      );
      await migrationPool.query(
        "GRANT SELECT (id) ON ops.release_leases TO lovechapter_gate_test_app",
      );
      await migrationPool.query(
        "GRANT DELETE ON ops.release_leases TO lovechapter_gate_test_app",
      );
      await migrationPool.query(
        "GRANT EXECUTE ON FUNCTION ops.admit_release_lease(text) TO lovechapter_gate_test_app",
      );
    }
  } finally {
    await migrationPool.end();
  }
  runtime = createPostgresRuntime({
    databaseUrl: connectionString,
    databasePoolMax: 6,
  });
});

afterEach(async () => {
  await runtime.pool.query("delete from ops.release_leases");
  await runtime.pool.query(
    `insert into ops.release_control (id, mode, target_sha) values (1, 'open', null)
     on conflict (id) do update set mode = 'open', target_sha = null,
       web_version_id = null, web_source_sha = null,
       api_version_id = null, api_source_sha = null`,
  );
});

afterAll(async () => {
  await runtime?.close();
});

function store(): GateStore | undefined {
  return Reflect.get(runtime, "releaseGateStore") as GateStore | undefined;
}

function versionsFor(sha: string) {
  return {
    web: { versionId: "web-integration-version", sourceSha: sha },
    api: { versionId: "api-integration-version", sourceSha: sha },
  };
}

async function controller(): Promise<{
  value: GateController | undefined;
  pid: number | undefined;
  close(): Promise<void>;
}> {
  const constructor = Reflect.get(database, "PostgresReleaseGateController") as
    (new (client: Client) => GateController) | undefined;
  if (!constructor)
    return { value: undefined, pid: undefined, close: async () => undefined };
  const client = new Client({ connectionString });
  await client.connect();
  const pid = await client.query<{ pid: number }>(
    "select pg_backend_pid() as pid",
  );
  if (!pid.rows[0]) throw new Error("Connected PostgreSQL PID is missing");
  return {
    value: new constructor(client),
    pid: pid.rows[0].pid,
    close: () => client.end(),
  };
}

async function waitForLock(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await runtime.pool.query<{ wait_event_type: string | null }>(
      "select wait_event_type from pg_stat_activity where pid = $1",
      [pid],
    );
    if (result.rows[0]?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Expected controller to wait on the control-row lock");
}

describe("PostgreSQL release gate", () => {
  it.skipIf(!localDisposable)(
    "operates against an isolated database migrated only through 0010",
    async () => {
      const fixtureName = `lovechapter_gate_0010_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const fixtureDirectory = await mkdtemp(
        join(tmpdir(), "lovechapter-0010-"),
      );
      const admin = new Client({ connectionString });
      const fixtureUrl = new URL(connectionString);
      fixtureUrl.pathname = `/${fixtureName}`;
      let fixture: Client | undefined;
      let created = false;
      await admin.connect();
      try {
        await admin.query(`create database ${fixtureName}`);
        created = true;
        await mkdir(join(fixtureDirectory, "meta"));
        const source = new URL("../drizzle/", import.meta.url);
        const journal = JSON.parse(
          await readFile(new URL("meta/_journal.json", source), "utf8"),
        ) as { entries: { tag: string }[] };
        const entries = journal.entries.filter((entry) =>
          /^00(?:0[0-9]|10)_/u.test(entry.tag),
        );
        expect(entries).toHaveLength(11);
        await writeFile(
          join(fixtureDirectory, "meta/_journal.json"),
          JSON.stringify({ ...journal, entries }),
        );
        for (const entry of entries) {
          await copyFile(
            new URL(`${entry.tag}.sql`, source),
            join(fixtureDirectory, `${entry.tag}.sql`),
          );
        }
        fixture = new Client({ connectionString: fixtureUrl.toString() });
        await fixture.connect();
        await migrate(drizzle({ client: fixture }), {
          migrationsFolder: fixtureDirectory,
        });
        const columns = await fixture.query<{ column_name: string }>(
          `select column_name from information_schema.columns
           where table_schema = 'ops' and table_name = 'release_control'`,
        );
        expect(columns.rows.map((row) => row.column_name)).not.toContain(
          "web_version_id",
        );
        const gate = new PostgresStagingBootstrapGate(fixture);
        expect((await gate.status()).mode).toBe("open");
        await fixture.query(
          "insert into ops.release_leases (id, kind) values (gen_random_uuid(), 'email')",
        );
        const closure = await gate.closeOnce("9".repeat(40));
        expect(closure.activeCount).toBe(1);
        await expect(gate.closeOnce("9".repeat(40))).rejects.toThrow();
        expect((await gate.status()).changedAt).toBe(closure.changedAt);
        await fixture.query("delete from ops.release_leases");
        expect(
          await gate.drain("9".repeat(40), closure.changedAt, {
            deadlineMs: Date.now() + 2_000,
          }),
        ).toMatchObject({ mode: "maintenance", activeCount: 0 });
        const retainedUserId = randomUUID();
        await fixture.query(
          `insert into users (id, auth_provider, auth_subject, display_name)
           values ($1, 'local', $2, 'Retained fixture')`,
          [retainedUserId, retainedUserId],
        );
        const stagingHost = "ep-fixture-staging.ap-southeast-1.aws.neon.tech";
        const checkpointHost =
          "ep-fixture-checkpoint.ap-southeast-1.aws.neon.tech";
        const environment = {
          RELEASE_ENVIRONMENT: "staging",
          RELEASE_DATABASE_URL: `postgresql://release:gate-password@${stagingHost}/lovechapter?sslmode=require`,
          RELEASE_DATABASE_ROLE: "release",
          RELEASE_MIGRATION_DATABASE_URL: `postgresql://migrator:migration-password@${stagingHost}/lovechapter?sslmode=require`,
          RELEASE_MIGRATION_DATABASE_ROLE: "migrator",
          RELEASE_CHECKPOINT_DATABASE_URL: `postgresql://checkpoint:checkpoint-password@${checkpointHost}/lovechapter?sslmode=require`,
          RELEASE_CHECKPOINT_DATABASE_ROLE: "checkpoint",
          RELEASE_APP_DATABASE_ROLE: "app",
          RELEASE_NEON_PROJECT_ID: "fixture-project",
          RELEASE_NEON_BRANCH_ID: "br-staging-fixture",
          RELEASE_DATABASE_NAME: "lovechapter",
          RELEASE_CLOUDFLARE_ACCOUNT_ID: "fixture-account",
          RELEASE_HYPERDRIVE_ID: "fixture-hyperdrive",
          RELEASE_NEON_API_KEY: "fixture-neon-token",
          RELEASE_CLOUDFLARE_API_TOKEN: "fixture-cloudflare-token",
        };
        const checkpointBranchId = "br-checkpoint-fixture";
        const checkpointLsn = "0/1DE2850";
        const fetcher = async (input: string | URL | Request) => {
          const url = String(input);
          if (url.endsWith(`/branches/${checkpointBranchId}`)) {
            return new Response(
              JSON.stringify({
                branch: {
                  id: checkpointBranchId,
                  project_id: environment.RELEASE_NEON_PROJECT_ID,
                  parent_id: environment.RELEASE_NEON_BRANCH_ID,
                  parent_lsn: checkpointLsn,
                  init_source: "parent-data",
                },
              }),
            );
          }
          if (url.endsWith(`/branches/${checkpointBranchId}/endpoints`)) {
            return new Response(
              JSON.stringify({
                endpoints: [
                  {
                    branch_id: checkpointBranchId,
                    host: checkpointHost,
                    type: "read_write",
                  },
                ],
              }),
            );
          }
          if (url.startsWith("https://console.neon.tech/")) {
            return new Response(
              JSON.stringify({
                endpoints: [
                  {
                    branch_id: environment.RELEASE_NEON_BRANCH_ID,
                    host: stagingHost,
                    type: "read_write",
                  },
                ],
              }),
            );
          }
          return new Response(
            JSON.stringify({
              success: true,
              result: {
                id: environment.RELEASE_HYPERDRIVE_ID,
                origin: {
                  host: stagingHost,
                  database: "lovechapter",
                  user: "app",
                },
                caching: { disabled: true },
              },
            }),
          );
        };
        const migrationArgs = [
          "--sha",
          "9".repeat(40),
          "--closed-at",
          closure.changedAt,
          "--checkpoint-branch-id",
          checkpointBranchId,
          "--checkpoint-lsn",
          checkpointLsn,
        ];
        const output: string[] = [];
        const options = {
          createClient: () =>
            new Client({ connectionString: fixtureUrl.toString() }),
          fetcher: fetcher as typeof fetch,
          write: (line: string) => output.push(line),
        };
        await runStagingBootstrapMigrationCli(
          migrationArgs,
          environment,
          options,
        );
        expect(output).toHaveLength(1);
        expect(JSON.parse(output[0]!)).toMatchObject({
          status: "applied_and_validated",
          checkpointBranchId,
        });
        const retained = await fixture.query<{ id: string }>(
          "select id from users where id = $1",
          [retainedUserId],
        );
        expect(retained.rows).toEqual([{ id: retainedUserId }]);
        expect(
          (
            await fixture.query(
              "select 1 from ops.release_control where id = 1",
            )
          ).rowCount,
        ).toBe(1);
        await expect(
          runStagingBootstrapMigrationCli(migrationArgs, environment, options),
        ).rejects.toThrow();
        expect(output).toHaveLength(1);
      } finally {
        await fixture?.end();
        if (created)
          await admin.query(`drop database ${fixtureName} with (force)`);
        await admin.end();
        await rm(fixtureDirectory, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it.skipIf(!restrictedConnectionString)(
    "admits through a role with no control UPDATE privilege",
    async () => {
      const restricted = createPostgresRuntime({
        databaseUrl: restrictedConnectionString!,
        databasePoolMax: 1,
      });
      try {
        const privilege = await restricted.pool.query<{
          can_update: boolean;
          can_insert_lease: boolean;
          can_execute: boolean;
        }>(
          `select has_table_privilege(current_user, 'ops.release_control', 'UPDATE') as can_update,
                  has_table_privilege(current_user, 'ops.release_leases', 'INSERT') as can_insert_lease,
                  has_function_privilege(current_user, 'ops.admit_release_lease(text)', 'EXECUTE') as can_execute`,
        );
        expect(privilege.rows[0]?.can_update).toBe(false);
        expect(privilege.rows[0]?.can_insert_lease).toBe(false);
        expect(privilege.rows[0]?.can_execute).toBe(true);
        const lease = await restricted.releaseGateStore.admit("http");
        expect(lease).toMatch(/^[0-9a-f-]{36}$/);
        if (lease) await restricted.releaseGateStore.release(lease);
      } finally {
        await restricted.close();
      }
    },
  );

  it("seeds one open control row", async () => {
    const gate = store();
    expect(gate).toBeDefined();
    if (!gate) return;
    expect(await gate.readMode()).toBe("open");
    const result = await runtime.pool.query<{ id: number; mode: string }>(
      "select id, mode from ops.release_control",
    );
    expect(result.rows).toEqual([{ id: 1, mode: "open" }]);
  });

  it("releases only the admitted lease", async () => {
    const gate = store();
    expect(gate).toBeDefined();
    if (!gate) return;
    const first = await gate.admit("http");
    const second = await gate.admit("email");
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(second).toMatch(/^[0-9a-f-]{36}$/);
    if (!first || !second) return;
    await gate.release(first);
    const result = await runtime.pool.query<{ id: string }>(
      "select id from ops.release_leases",
    );
    expect(result.rows).toEqual([{ id: second }]);
  });

  it("fails closed without control state", async () => {
    const gate = store();
    expect(gate).toBeDefined();
    if (!gate) return;
    await runtime.pool.query("delete from ops.release_control");
    await expect(gate.readMode()).rejects.toThrow();
    await expect(gate.admit("http")).rejects.toThrow();
  });

  it("rejects a partial Worker-version baseline at the database constraint", async () => {
    await expect(
      runtime.pool.query(
        "update ops.release_control set web_version_id = 'partial' where id = 1",
      ),
    ).rejects.toThrow();
  });

  it("refuses unsafe reopen", async () => {
    const instance = await controller();
    try {
      expect(instance.value).toBeDefined();
      if (!instance.value) return;
      const sha = "a".repeat(40);
      await instance.value.closeFor(sha);
      const closedAt = (await instance.value.status()).changedAt;
      expect(
        await instance.value.openFor(
          "b".repeat(40),
          closedAt,
          versionsFor(sha),
        ),
      ).toBe(false);
      const gate = store();
      expect(gate).toBeDefined();
      if (!gate) return;
      expect(await gate.admit("http")).toBeNull();
      expect(
        await instance.value.openFor(sha, closedAt, versionsFor(sha)),
      ).toBe(true);
      const status = await instance.value.status();
      expect(status.web).toEqual(versionsFor(sha).web);
      expect(status.api).toEqual(versionsFor(sha).api);
    } finally {
      await instance.close();
    }
  });

  it("keeps maintenance closed for an orphaned active lease", async () => {
    const gate = store();
    const instance = await controller();
    try {
      expect(gate).toBeDefined();
      expect(instance.value).toBeDefined();
      if (!gate || !instance.value) return;
      const lease = await gate.admit("cleanup");
      expect(lease).not.toBeNull();
      await instance.value.closeFor("e".repeat(40));
      const closedAt = (await instance.value.status()).changedAt;
      expect(
        await instance.value.openFor(
          "e".repeat(40),
          closedAt,
          versionsFor("e".repeat(40)),
        ),
      ).toBe(false);
      expect(await instance.value.activeCount()).toBe(1);
      if (lease) await gate.release(lease);
      expect(
        await instance.value.openFor(
          "e".repeat(40),
          closedAt,
          versionsFor("e".repeat(40)),
        ),
      ).toBe(true);
    } finally {
      await instance.close();
    }
  });

  it("cannot reopen with a closure timestamp from an earlier close of the same SHA", async () => {
    const instance = await controller();
    try {
      expect(instance.value).toBeDefined();
      if (!instance.value) return;
      const sha = "f".repeat(40);
      await instance.value.closeFor(sha);
      const stale = (await instance.value.status()).changedAt;
      await new Promise((resolve) => setTimeout(resolve, 10));
      await instance.value.closeFor(sha);
      const current = (await instance.value.status()).changedAt;
      expect(current).not.toBe(stale);
      expect(await instance.value.openFor(sha, stale, versionsFor(sha))).toBe(
        false,
      );
      expect(await instance.value.openFor(sha, current, versionsFor(sha))).toBe(
        true,
      );
    } finally {
      await instance.close();
    }
  });

  it("orders admission before closure", async () => {
    const gate = store();
    expect(gate).toBeDefined();
    if (!gate) return;
    const lease = await gate.admit("http");
    expect(lease).not.toBeNull();
    const instance = await controller();
    try {
      expect(instance.value).toBeDefined();
      if (!instance.value) return;
      await instance.value.closeFor("c".repeat(40));
      expect(await instance.value.activeCount()).toBe(1);
      expect(await gate.admit("email")).toBeNull();
      if (lease) await gate.release(lease);
      expect(await instance.value.activeCount()).toBe(0);
    } finally {
      await instance.close();
    }
  });

  it("does not admit a request queued behind closure", async () => {
    const gate = store();
    expect(gate).toBeDefined();
    if (!gate) return;
    const blocker = new Client({ connectionString });
    const instance = await controller();
    expect(instance.value).toBeDefined();
    expect(instance.pid).toBeDefined();
    if (!instance.value || !instance.pid) return;
    await blocker.connect();
    let closing: Promise<void> | undefined;
    let admitting: Promise<string | null> | undefined;
    try {
      await blocker.query("begin");
      await blocker.query(
        "select id from ops.release_control where id = 1 for update",
      );
      closing = instance.value.closeFor("d".repeat(40));
      await waitForLock(instance.pid);
      admitting = gate.admit("http");
      let admissionSettled = false;
      void admitting.then(
        () => {
          admissionSettled = true;
        },
        () => {
          admissionSettled = true;
        },
      );
      let admissionWaitingOnLock = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (admissionSettled) break;
        const waiting = await runtime.pool.query<{ count: string }>(
          `select count(*)::text as count from pg_stat_activity
           where wait_event_type = 'Lock' and query like '%ops.admit_release_lease%'`,
        );
        if (Number(waiting.rows[0]?.count) > 0) {
          admissionWaitingOnLock = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(admissionWaitingOnLock).toBe(true);
      expect(admissionSettled).toBe(false);
      await blocker.query("commit");
      await closing;
      expect(await admitting).toBeNull();
    } finally {
      await blocker.query("rollback");
      await Promise.allSettled([closing, admitting].filter(Boolean));
      await blocker.end();
      await instance.close();
    }
  });

  it("bounds operator lease details but counts all active work", async () => {
    const instance = await controller();
    try {
      expect(instance.value).toBeDefined();
      if (!instance.value) return;
      await runtime.pool.query(
        `insert into ops.release_leases (id, kind)
         select gen_random_uuid(), 'http' from generate_series(1, 101)`,
      );
      const status = await instance.value.status();
      expect(status.mode).toBe("open");
      expect(status.targetSha).toBeNull();
      expect(status.activeCount).toBe(101);
      expect(status.oldestLeases).toHaveLength(100);
      expect(
        status.oldestLeases.every((lease) =>
          ["http", "email", "cleanup"].includes(lease.kind),
        ),
      ).toBe(true);
    } finally {
      await instance.close();
    }
  });
});
