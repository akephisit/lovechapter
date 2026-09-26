import { sql } from "drizzle-orm";
import type { Client } from "pg";

import type { QueryExecutor } from "./repository";
import type { WorkerVersion } from "./release-evidence";

export type ReleaseMode = "open" | "maintenance";
export type GateKind = "http" | "email" | "cleanup";

export type ReleaseGateStore = {
  readMode(): Promise<ReleaseMode>;
  admit(kind: GateKind): Promise<string | null>;
  release(id: string): Promise<void>;
};

function modeFromRows(rows: { mode: string }[]): ReleaseMode {
  const row = rows[0];
  if (
    rows.length !== 1 ||
    !row ||
    !["open", "maintenance"].includes(row.mode)
  ) {
    throw new Error("Release control state is unavailable");
  }
  return row.mode as ReleaseMode;
}

export class PostgresReleaseGateStore implements ReleaseGateStore {
  constructor(private readonly executor: QueryExecutor) {}

  async readMode(): Promise<ReleaseMode> {
    const result = await this.executor.execute<{ mode: string }>(
      sql`select mode from ops.release_control where id = 1`,
    );
    return modeFromRows(result.rows);
  }

  async admit(kind: GateKind): Promise<string | null> {
    const result = await this.executor.execute<{ lease_id: string | null }>(
      sql`select ops.admit_release_lease(${kind}) as lease_id`,
    );
    if (result.rows.length !== 1 || !result.rows[0]) {
      throw new Error("Release admission result is unavailable");
    }
    return result.rows[0].lease_id;
  }

  async release(id: string): Promise<void> {
    await this.executor.execute(
      sql`delete from ops.release_leases where id = ${id}`,
    );
  }
}

export type ReleaseGateStatus = {
  mode: ReleaseMode;
  targetSha: string | null;
  changedAt: string;
  web: WorkerVersion | null;
  api: WorkerVersion | null;
  activeCount: number;
  oldestLeases: { id: string; kind: GateKind; startedAt: string }[];
};

const shaPattern = /^[0-9a-f]{40}$/;

export class PostgresReleaseGateController {
  constructor(private readonly client: Client) {}

  async closeFor(sha: string): Promise<void> {
    if (!shaPattern.test(sha))
      throw new Error("A full lowercase commit SHA is required");
    const result = await this.client.query(
      `update ops.release_control
       set mode = 'maintenance', target_sha = $1, changed_at = now()
       where id = 1 and (mode = 'open' or (mode = 'maintenance' and target_sha = $1))
       returning id`,
      [sha],
    );
    if (result.rowCount !== 1) {
      throw new Error(
        "Release control is missing or already targets another SHA",
      );
    }
  }

  async activeCount(): Promise<number> {
    const result = await this.client.query<{ count: string }>(
      "select count(*)::text as count from ops.release_leases",
    );
    const count = Number(result.rows[0]?.count);
    if (!Number.isSafeInteger(count))
      throw new Error("Active lease count is invalid");
    return count;
  }

  async status(): Promise<ReleaseGateStatus> {
    const control = await this.client.query<{
      mode: string;
      target_sha: string | null;
      changed_at: string;
      web_version_id: string | null;
      web_source_sha: string | null;
      api_version_id: string | null;
      api_source_sha: string | null;
    }>(
      `select mode, target_sha, changed_at::text,
              web_version_id, web_source_sha, api_version_id, api_source_sha
       from ops.release_control where id = 1`,
    );
    const mode = modeFromRows(control.rows);
    const row = control.rows[0];
    if (!row) throw new Error("Release control state is unavailable");
    const versionFields = [
      row.web_version_id,
      row.web_source_sha,
      row.api_version_id,
      row.api_source_sha,
    ];
    if (
      versionFields.some((value) => value === null) &&
      versionFields.some((value) => value !== null)
    ) {
      throw new Error("Release control versions are incomplete");
    }
    const activeCount = await this.activeCount();
    const leases = await this.client.query<{
      id: string;
      kind: GateKind;
      started_at: Date;
    }>(
      "select id, kind, started_at from ops.release_leases order by started_at, id limit 100",
    );
    return {
      mode,
      targetSha: row.target_sha,
      changedAt: row.changed_at,
      web:
        row.web_version_id && row.web_source_sha
          ? { versionId: row.web_version_id, sourceSha: row.web_source_sha }
          : null,
      api:
        row.api_version_id && row.api_source_sha
          ? { versionId: row.api_version_id, sourceSha: row.api_source_sha }
          : null,
      activeCount,
      oldestLeases: leases.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        startedAt: row.started_at.toISOString(),
      })),
    };
  }

  async openFor(
    sha: string,
    changedAt: string,
    versions: { web: WorkerVersion; api: WorkerVersion },
  ): Promise<boolean> {
    if (!shaPattern.test(sha))
      throw new Error("A full lowercase commit SHA is required");
    if (!Number.isFinite(Date.parse(changedAt))) {
      throw new Error("Release closure timestamp is invalid");
    }
    if (
      !versions?.web?.versionId ||
      !shaPattern.test(versions.web.sourceSha) ||
      !versions.api?.versionId ||
      !shaPattern.test(versions.api.sourceSha)
    ) {
      throw new Error("Release Worker versions are invalid");
    }
    const result = await this.client.query(
      `update ops.release_control
       set mode = 'open', changed_at = now(),
           web_version_id = $3, web_source_sha = $4,
           api_version_id = $5, api_source_sha = $6
       where id = 1 and mode = 'maintenance' and target_sha = $1
         and changed_at = $2::timestamptz
         and not exists (select 1 from ops.release_leases)
       returning id`,
      [
        sha,
        changedAt,
        versions.web.versionId,
        versions.web.sourceSha,
        versions.api.versionId,
        versions.api.sourceSha,
      ],
    );
    return result.rowCount === 1;
  }
}
