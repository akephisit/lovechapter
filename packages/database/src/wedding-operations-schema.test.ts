import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  budgetCategories,
  budgetConfigs,
  expenses,
  runSheetItems,
  seatingAssignments,
  seatingTables,
  vendors,
} from "./schema";

describe("wedding operations tables", () => {
  it("keeps records scoped to weddings and uses composite references", () => {
    expect(budgetConfigs.weddingId.primary).toBe(true);
    for (const table of [
      budgetCategories,
      vendors,
      expenses,
      runSheetItems,
      seatingTables,
    ]) {
      const config = getTableConfig(table);
      expect(config.primaryKeys[0]?.columns.map((c) => c.name)).toEqual([
        "wedding_id",
        "id",
      ]);
    }
    const expenseReferences = getTableConfig(expenses).foreignKeys.map((fk) =>
      fk.reference().foreignColumns.map((c) => c.name),
    );
    expect(expenseReferences).toContainEqual(["wedding_id", "id"]);
    expect(
      getTableConfig(seatingAssignments).primaryKeys[0]?.columns.map(
        (c) => c.name,
      ),
    ).toEqual(["wedding_id", "guest_id"]);
    expect(getTableConfig(seatingAssignments).foreignKeys).toHaveLength(2);
  });
});
