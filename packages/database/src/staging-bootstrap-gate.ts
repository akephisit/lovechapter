import type { Client } from "pg";

import type { GateKind, ReleaseMode } from "./release-gate-repository";

export type PreSchemaGateStatus = {
  mode: ReleaseMode;
  targetSha: string | null;
  changedAt: string;
  activeCount: number;
  oldestLeases: { id: string; kind: GateKind; startedAt: string }[];
};

const shaPattern = /^[0-9a-f]{40}$/u;

/** The one-time staging reader deliberately knows only the pre-0011 schema. */
export class PostgresStagingBootstrapGate {
  constructor(private readonly client: Client) {}

  async closeOnce(sha: string): Promise<PreSchemaGateStatus> {
    if (!shaPattern.test(sha)) {
      throw new Error("A full lowercase commit SHA is required");
    }
    const updated = await this.client.query<{ changed_at: string }>(
      `update ops.release_control
       set mode = 'maintenance', target_sha = $1, changed_at = now()
       where id = 1 and mode = 'open'
       returning changed_at::text`,
      [sha],
    );
    if (updated.rowCount !== 1 || !updated.rows[0]) {
      throw new Error("Pre-schema gate is not open for first closure");
    }
    const status = await this.status();
    if (
      status.mode !== "maintenance" ||
      status.targetSha !== sha ||
      status.changedAt !== updated.rows[0].changed_at
    ) {
      throw new Error("Pre-schema gate closure changed unexpectedly");
    }
    return status;
  }

  async drain(
    sha: string,
    closedAt: string,
    options: { deadlineMs: number; signal?: AbortSignal },
  ): Promise<PreSchemaGateStatus> {
    if (
      !shaPattern.test(sha) ||
      !Number.isFinite(Date.parse(closedAt)) ||
      !Number.isSafeInteger(options?.deadlineMs)
    ) {
      throw new Error("Pre-schema drain inputs are invalid");
    }
    while (true) {
      if (options.signal?.aborted)
        throw new Error("Pre-schema drain interrupted");
      const status = await this.status();
      if (
        status.mode !== "maintenance" ||
        status.targetSha !== sha ||
        status.changedAt !== closedAt
      ) {
        throw new Error("Pre-schema gate closure changed during drain");
      }
      if (status.activeCount === 0) return status;
      const remainingMs = options.deadlineMs - Date.now();
      if (remainingMs <= 0) {
        throw new Error("Pre-schema drain timed out; gate remains closed");
      }
      await delay(Math.min(1_000, remainingMs), options.signal);
    }
  }

  async status(): Promise<PreSchemaGateStatus> {
    const control = await this.client.query<{
      mode: string;
      target_sha: string | null;
      changed_at: string;
    }>(
      `select mode, target_sha, changed_at::text
       from ops.release_control where id = 1`,
    );
    const row = control.rows[0];
    if (
      control.rows.length !== 1 ||
      !row ||
      (row.mode !== "open" && row.mode !== "maintenance") ||
      (row.target_sha !== null && !shaPattern.test(row.target_sha)) ||
      !Number.isFinite(Date.parse(row.changed_at))
    ) {
      throw new Error("Pre-schema release control state is invalid");
    }
    const countResult = await this.client.query<{ count: string }>(
      "select count(*)::text as count from ops.release_leases",
    );
    const activeCount = Number(countResult.rows[0]?.count);
    if (
      countResult.rows.length !== 1 ||
      !Number.isSafeInteger(activeCount) ||
      activeCount < 0
    ) {
      throw new Error("Pre-schema active lease count is invalid");
    }
    const leaseResult = await this.client.query<{
      id: string;
      kind: GateKind;
      started_at: Date;
    }>(
      `select id, kind, started_at from ops.release_leases
       order by started_at, id limit 100`,
    );
    return {
      mode: row.mode,
      targetSha: row.target_sha,
      changedAt: row.changed_at,
      activeCount,
      oldestLeases: leaseResult.rows.map((lease) => ({
        id: lease.id,
        kind: lease.kind,
        startedAt: lease.started_at.toISOString(),
      })),
    };
  }
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Pre-schema drain interrupted"));
      return;
    }
    const timer = setTimeout(done, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
    function done() {
      signal?.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      reject(new Error("Pre-schema drain interrupted"));
    }
  });
}
