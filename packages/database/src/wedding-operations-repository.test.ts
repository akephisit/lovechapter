import { PgDialect } from "drizzle-orm/pg-core";
import { ConflictError } from "@lovechapter/domain";
import { describe, expect, it } from "vitest";

import {
  authorizedWedding,
  listExpenseQuery,
  PostgresWeddingOperationsRepository,
  seatUsageQuery,
} from "./wedding-operations-repository";
import type { QueryExecutor } from "./repository";
import {
  buildLockGuestForSeatingQuery,
  buildUpdateGuestQuery,
} from "./queries";

const dialect = new PgDialect();
const scope = {
  userId: "11111111-1111-4111-8111-111111111111",
  weddingId: "22222222-2222-4222-8222-222222222222",
};

describe("wedding operations SQL", () => {
  it("checks membership within every expense page and reserves seats by party size", () => {
    const auth = dialect.sqlToQuery(authorizedWedding(scope));
    expect(auth.sql).toContain("wedding_members");
    const costs = dialect.sqlToQuery(listExpenseQuery({ ...scope, limit: 20 }));
    expect(costs.sql).toContain("wedding_members");
    expect(costs.sql).toMatch(/order by.*created_at.*desc.*id.*desc/s);
    expect(costs.params).toContain(21);
    const seats = dialect.sqlToQuery(
      seatUsageQuery({
        ...scope,
        tableId: "33333333-3333-4333-8333-333333333333",
      }),
    );
    expect(seats.sql).toContain("allowed_party_size");
    expect(seats.sql).toContain("wedding_members");
  });

  it("blocks changing the allowed party size while seats are reserved", () => {
    const lock = dialect.sqlToQuery(
      buildLockGuestForSeatingQuery({
        ...scope,
        guestId: "33333333-3333-4333-8333-333333333333",
      }),
    );
    expect(lock.sql).toContain("wedding_members");
    expect(lock.sql).toMatch(/for update/);
    const update = dialect.sqlToQuery(
      buildUpdateGuestQuery({
        ...scope,
        guestId: "33333333-3333-4333-8333-333333333333",
        patch: { allowedPartySize: 4 },
      }),
    );
    expect(update.sql).toContain("seating_assignments");
    expect(update.sql).toMatch(/not exists/);
  });
  it("returns an actionable conflict for a duplicate budget category name", async () => {
    const executor = {
      execute: async (query: Parameters<QueryExecutor["execute"]>[0]) => {
        const statement = dialect.sqlToQuery(query).sql;
        if (statement.includes('insert into "budget_categories"'))
          throw Object.assign(new Error("duplicate"), { code: "23505" });
        if (statement.includes("count(*)")) return { rows: [{ count: 0 }] };
        return { rows: [{ id: scope.weddingId }] };
      },
      transaction: async (operation: (tx: QueryExecutor) => Promise<unknown>) =>
        operation(executor as QueryExecutor),
    } as QueryExecutor;
    const repo = new PostgresWeddingOperationsRepository(executor);
    await expect(
      repo.saveBudgetCategory(
        scope.userId,
        scope.weddingId,
        crypto.randomUUID(),
        { name: "Venue" },
        true,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
  it("returns an actionable conflict for a duplicate seating table name", async () => {
    const executor = {
      execute: async (query: Parameters<QueryExecutor["execute"]>[0]) => {
        const statement = dialect.sqlToQuery(query).sql;
        if (statement.includes('insert into "seating_tables"'))
          throw Object.assign(new Error("duplicate"), { code: "23505" });
        if (statement.includes("count(*)")) return { rows: [{ count: 0 }] };
        return { rows: [{ id: scope.weddingId }] };
      },
      transaction: async (operation: (tx: QueryExecutor) => Promise<unknown>) =>
        operation(executor as QueryExecutor),
    } as QueryExecutor;
    const repo = new PostgresWeddingOperationsRepository(executor);
    await expect(
      repo.saveSeatingTable(
        scope.userId,
        scope.weddingId,
        crypto.randomUUID(),
        { name: "A", capacity: 8 },
        true,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
