import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { NotFoundError } from "@lovechapter/domain";
import { PostgresPlanningRepository } from "./planning-repository";
import type { QueryExecutor } from "./repository";

const dialect = new PgDialect();
const userId = "11111111-1111-4111-8111-111111111111";
const weddingId = "22222222-2222-4222-8222-222222222222";

describe("PostgresPlanningRepository", () => {
  it("rejects a nonmember even when the list has no tasks", async () => {
    const queries: string[] = [];
    const executor = {
      execute: async (query: Parameters<QueryExecutor["execute"]>[0]) => {
        queries.push(dialect.sqlToQuery(query).sql);
        return { rows: [] };
      },
    } as unknown as QueryExecutor;
    const repository = new PostgresPlanningRepository(executor);
    await expect(
      repository.listPlanningTasks(userId, weddingId, {
        limit: 20,
        filter: "all",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatch(/wedding_members/);
  });
});
