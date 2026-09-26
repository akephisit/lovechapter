import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import * as database from "./index";
import { createPostgresRuntime, type PostgresRuntime } from "./client";

const connectionString = process.env.TEST_DATABASE_URL;
if (
  !connectionString ||
  process.env.TEST_DATABASE_CONFIRM !== "lovechapter_test" ||
  connectionString === process.env.DATABASE_URL
) {
  throw new Error("Release gate integration requires a disposable database");
}

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
    activeCount: number;
    oldestLeases: { id: string; kind: string; startedAt: string }[];
  }>;
  openFor(sha: string): Promise<boolean>;
};

let runtime: PostgresRuntime;

beforeAll(async () => {
  const migrationPool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle({ client: migrationPool }), {
      migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
    });
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
    "insert into ops.release_control (id, mode, target_sha) values (1, 'open', null) on conflict (id) do update set mode = 'open', target_sha = null",
  );
});

afterAll(async () => {
  await runtime?.close();
});

function store(): GateStore | undefined {
  return Reflect.get(runtime, "releaseGateStore") as GateStore | undefined;
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

  it("refuses unsafe reopen", async () => {
    const instance = await controller();
    try {
      expect(instance.value).toBeDefined();
      if (!instance.value) return;
      const sha = "a".repeat(40);
      await instance.value.closeFor(sha);
      expect(await instance.value.openFor("b".repeat(40))).toBe(false);
      const gate = store();
      expect(gate).toBeDefined();
      if (!gate) return;
      expect(await gate.admit("http")).toBeNull();
      expect(await instance.value.openFor(sha)).toBe(true);
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
           where wait_event_type = 'Lock' and query like '%ops.release_control%for share%'`,
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
