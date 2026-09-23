import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildPlanningListQuery,
  buildPlanningUpdateQuery,
  buildPlanningUpcomingQuery,
} from "./planning-queries";

const dialect = new PgDialect();
const scope = {
  userId: "11111111-1111-4111-8111-111111111111",
  weddingId: "22222222-2222-4222-8222-222222222222",
};

describe("planning SQL", () => {
  it("authorizes and bounds deterministic task and deadline pages", () => {
    const list = dialect.sqlToQuery(
      buildPlanningListQuery({
        ...scope,
        limit: 20,
        filter: "open",
        cursor: {
          createdAt: "2026-09-23T00:00:00.000Z",
          id: "33333333-3333-4333-8333-333333333333",
        },
      }),
    );
    expect(list.sql).toMatch(/wedding_members/);
    expect(list.sql).toMatch(
      /to_char\("planning_tasks"\."due_date", 'YYYY-MM-DD'\)/,
    );
    expect(list.sql).toMatch(/HH24:MI:SS\.US/);
    expect(list.sql).toMatch(/created_at.*id.*\)\s*</s);
    expect(list.sql).toMatch(/order by.*created_at.*desc.*id.*desc/s);
    expect(list.params).toContain(21);
    const deadlines = dialect.sqlToQuery(buildPlanningUpcomingQuery(scope));
    expect(deadlines.sql).toMatch(/wedding_members/);
    expect(deadlines.sql).toMatch(/completed_at.*is null/);
    expect(deadlines.sql).toMatch(/limit 8/);
  });

  it("scopes completion-only updates and leaves unrelated fields untouched", () => {
    const query = dialect.sqlToQuery(
      buildPlanningUpdateQuery({
        ...scope,
        taskId: "33333333-3333-4333-8333-333333333333",
        patch: { completed: true },
      }),
    );
    expect(query.sql).toMatch(/wedding_members/);
    expect(query.sql).toMatch(/"planning_tasks"\."wedding_id"/);
    expect(query.sql).toMatch(/coalesce\(/);
    expect(query.sql).not.toMatch(/"title"\s*=/);
  });

  it("uses PostgreSQL's unqualified SET targets for every changed task field", () => {
    const query = dialect.sqlToQuery(
      buildPlanningUpdateQuery({
        ...scope,
        taskId: "33333333-3333-4333-8333-333333333333",
        patch: {
          title: "Flowers",
          category: "Decor",
          note: null,
          dueDate: "2026-12-01",
          completed: true,
        },
      }),
    );
    expect(query.sql).toMatch(/set\s+"title"\s*=/i);
    expect(query.sql).toMatch(/,\s*"completed_at"\s*=/i);
    expect(query.sql).not.toMatch(/set\s+"planning_tasks"\./i);
  });
});
