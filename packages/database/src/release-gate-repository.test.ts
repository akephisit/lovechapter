import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import type { QueryExecutor } from "./repository";
import { PostgresReleaseGateStore } from "./release-gate-repository";

const sha = "a".repeat(40);

function store(rows: unknown[]) {
  const execute = vi.fn(async (_query: SQL) => ({ rows }));
  return {
    gate: new PostgresReleaseGateStore({ execute } as unknown as QueryExecutor),
    execute,
  };
}

describe("public release state", () => {
  it("reads the open published SHA in one bounded singleton query", async () => {
    const { gate, execute } = store([{ mode: "open", published_sha: sha }]);
    await expect(gate.readPublicState()).resolves.toEqual({
      mode: "open",
      publishedSha: sha,
    });
    expect(execute).toHaveBeenCalledOnce();
    const statement = execute.mock.calls[0]?.[0];
    expect(statement).toBeDefined();
    if (!statement) throw new Error("Expected the singleton query");
    const query = new PgDialect().sqlToQuery(statement);
    expect(query.sql).toMatch(/from ops\.release_control where id = 1/iu);
    expect(query.sql).toMatch(/case when mode = 'open'/iu);
  });

  it("never exposes the candidate target SHA while maintenance is active", async () => {
    const { gate } = store([{ mode: "maintenance", published_sha: sha }]);
    await expect(gate.readPublicState()).resolves.toEqual({
      mode: "maintenance",
      publishedSha: null,
    });
  });

  it("rejects missing, duplicate, or malformed open release state", async () => {
    for (const rows of [
      [],
      [{ mode: "open", published_sha: "short" }],
      [
        { mode: "open", published_sha: sha },
        { mode: "open", published_sha: sha },
      ],
    ]) {
      await expect(store(rows).gate.readPublicState()).rejects.toThrow();
    }
  });
});
