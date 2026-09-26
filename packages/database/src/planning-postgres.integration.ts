import { decodeCursor, NotFoundError } from "@lovechapter/domain";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createPostgresRuntime, type PostgresRuntime } from "./client";

const connectionString = process.env.TEST_DATABASE_URL;
if (
  !connectionString ||
  process.env.TEST_DATABASE_CONFIRM !== "lovechapter_test"
)
  throw new Error(
    "Planning integration requires a confirmed disposable TEST_DATABASE_URL",
  );
if (connectionString === process.env.DATABASE_URL)
  throw new Error("TEST_DATABASE_URL must not reuse DATABASE_URL");

let runtime: PostgresRuntime;
beforeAll(async () => {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), {
      migrationsFolder: new URL("../drizzle", import.meta.url).pathname,
    });
  } finally {
    await pool.end();
  }
  runtime = createPostgresRuntime({
    databaseUrl: connectionString,
    databasePoolMax: 6,
  });
});
beforeEach(async () => {
  await runtime.pool.query("truncate users cascade");
});
afterAll(async () => {
  await runtime?.close();
});

describe("PostgreSQL wedding planning", () => {
  it("pages tasks, counts all tasks, orders deadlines, and isolates weddings", async () => {
    const owner = await runtime.loveChapterRepository.syncUser({
      provider: "development",
      subject: crypto.randomUUID(),
      displayName: "Owner",
    });
    const outsider = await runtime.loveChapterRepository.syncUser({
      provider: "development",
      subject: crypto.randomUUID(),
      displayName: "Outsider",
    });
    const first = await runtime.loveChapterRepository.createWedding(
      owner.id,
      crypto.randomUUID(),
      { name: "First", timeZone: "UTC", locale: "en" },
    );
    const second = await runtime.loveChapterRepository.createWedding(
      owner.id,
      crypto.randomUUID(),
      { name: "Second", timeZone: "UTC", locale: "en" },
    );
    const create = (title: string, dueDate: string | null) =>
      runtime.planningRepository.createPlanningTask(
        owner.id,
        first.id,
        crypto.randomUUID(),
        { title, category: null, note: null, dueDate },
      );
    const later = await create("Flowers", "2026-12-20");
    const sooner = await create("Venue", "2026-12-01");
    expect(sooner.dueDate).toBe("2026-12-01");
    await create("No date", null);
    const page = await runtime.planningRepository.listPlanningTasks(
      owner.id,
      first.id,
      { limit: 1, filter: "all" },
    );
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
    expect(decodeCursor(page.nextCursor!).createdAt).toMatch(/\.\d{6}Z$/);
    const next = await runtime.planningRepository.listPlanningTasks(
      owner.id,
      first.id,
      { limit: 1, filter: "all", cursor: decodeCursor(page.nextCursor!) },
    );
    expect(next.items[0]?.id).not.toBe(page.items[0]?.id);
    expect(
      await runtime.planningRepository.getPlanningOverview(owner.id, first.id),
    ).toMatchObject({
      total: 3,
      completed: 0,
      upcoming: [{ id: sooner.id }, { id: later.id }],
    });
    await expect(
      runtime.planningRepository.updatePlanningTask(
        owner.id,
        second.id,
        sooner.id,
        { completed: true },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      runtime.planningRepository.getPlanningOverview(outsider.id, first.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    const completed = await runtime.planningRepository.updatePlanningTask(
      owner.id,
      first.id,
      sooner.id,
      { completed: true },
    );
    expect(completed.completedAt).toBeTruthy();
    expect(
      (await runtime.planningRepository.getPlanningOverview(owner.id, first.id))
        .completed,
    ).toBe(1);
    await runtime.planningRepository.deletePlanningTask(
      owner.id,
      first.id,
      sooner.id,
    );
    expect(
      (await runtime.planningRepository.getPlanningOverview(owner.id, first.id))
        .total,
    ).toBe(2);
  });
});
