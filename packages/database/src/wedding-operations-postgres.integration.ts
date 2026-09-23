import {
  ConflictError,
  decodeCursor,
  NotFoundError,
} from "@lovechapter/domain";
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
    "Wedding operations integration requires a disposable TEST_DATABASE_URL",
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

async function fixture() {
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
  const wedding = await runtime.loveChapterRepository.createWedding(
    owner.id,
    crypto.randomUUID(),
    { name: "Wedding", timeZone: "Asia/Bangkok", locale: "th-TH" },
  );
  return { owner, outsider, wedding };
}

describe("PostgreSQL wedding operations", () => {
  it("tracks money and vendors with wedding-scoped references and detached deletions", async () => {
    const { owner, outsider, wedding } = await fixture();
    const repo = runtime.operationsRepository;
    await expect(
      repo.getBudgetOverview(outsider.id, wedding.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await repo.setBudget(owner.id, wedding.id, {
      currency: "THB",
      targetMinor: 500000,
    });
    const category = await repo.saveBudgetCategory(
      owner.id,
      wedding.id,
      crypto.randomUUID(),
      { name: "Venue" },
      true,
    );
    const vendor = await repo.saveVendor(
      owner.id,
      wedding.id,
      crypto.randomUUID(),
      {
        name: "Venue One",
        status: "booked",
        contactName: null,
        email: null,
        phone: null,
        quoteMinor: 20000,
        note: null,
      },
      true,
    );
    await expect(
      repo.setBudget(owner.id, wedding.id, {
        currency: "USD",
        targetMinor: 500000,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    const expense = await repo.saveExpense(
      owner.id,
      wedding.id,
      crypto.randomUUID(),
      {
        title: "Deposit",
        plannedMinor: 20000,
        paidMinor: 5000,
        categoryId: category.id,
        vendorId: vendor.id,
        dueDate: "2026-12-01",
        note: null,
      },
      true,
    );
    expect(expense.dueDate).toBe("2026-12-01");
    expect(await repo.getBudgetOverview(owner.id, wedding.id)).toMatchObject({
      plannedMinor: 20000,
      paidMinor: 5000,
      remainingMinor: 15000,
    });
    await expect(
      repo.setBudget(owner.id, wedding.id, {
        currency: "USD",
        targetMinor: 500000,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      repo.saveExpense(
        outsider.id,
        wedding.id,
        crypto.randomUUID(),
        {
          title: "Unauthorized",
          plannedMinor: 1,
          paidMinor: 0,
          categoryId: null,
          vendorId: null,
          dueDate: null,
          note: null,
        },
        true,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await repo.deleteBudgetCategory(owner.id, wedding.id, category.id);
    await repo.deleteVendor(owner.id, wedding.id, vendor.id);
    expect(
      (await repo.listExpenses(owner.id, wedding.id, { limit: 20 })).items[0],
    ).toMatchObject({ categoryId: null, vendorId: null });
    await repo.deleteExpense(owner.id, wedding.id, expense.id);
    expect(
      (await repo.getBudgetOverview(owner.id, wedding.id)).plannedMinor,
    ).toBe(0);
  });

  it("orders private run sheet and rejects cross-wedding modifications", async () => {
    const { owner, outsider, wedding } = await fixture();
    const repo = runtime.operationsRepository;
    const early = await repo.saveRunSheetItem(
      owner.id,
      wedding.id,
      crypto.randomUUID(),
      {
        title: "Morning",
        startsAt: "2026-12-19T02:00:00.000Z",
        endsAt: "2026-12-19T03:00:00.000Z",
        location: "Hall",
        responsible: "Planner",
        note: null,
      },
      true,
    );
    await repo.saveRunSheetItem(
      owner.id,
      wedding.id,
      crypto.randomUUID(),
      {
        title: "Evening",
        startsAt: "2026-12-19T11:00:00.000Z",
        endsAt: "2026-12-19T12:00:00.000Z",
        location: null,
        responsible: null,
        note: null,
      },
      true,
    );
    const first = await repo.listRunSheet(owner.id, wedding.id, { limit: 1 });
    expect(first.items[0]).toMatchObject({
      id: early.id,
      startsAt: expect.stringMatching(/\.\d{6}Z$/),
    });
    const second = await repo.listRunSheet(owner.id, wedding.id, {
      limit: 1,
      cursor: decodeCursor(first.nextCursor!),
    });
    expect(second.items[0]?.title).toBe("Evening");
    await expect(
      repo.deleteRunSheetItem(outsider.id, wedding.id, early.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("serializes seat reservations and prevents guest party size from invalidating capacity", async () => {
    const { owner, wedding } = await fixture();
    const repo = runtime.operationsRepository;
    const table = await repo.saveSeatingTable(
      owner.id,
      wedding.id,
      crypto.randomUUID(),
      { name: "A", capacity: 3 },
      true,
    );
    const createGuest = (name: string) =>
      runtime.loveChapterRepository.createGuest(
        owner.id,
        wedding.id,
        crypto.randomUUID(),
        { name, allowedPartySize: 2 },
      );
    const first = await createGuest("First");
    const second = await createGuest("Second");
    const attempts = await Promise.allSettled([
      repo.assignSeating(owner.id, wedding.id, first.id, table.id),
      repo.assignSeating(owner.id, wedding.id, second.id, table.id),
    ]);
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(
      (await repo.listSeatingTables(owner.id, wedding.id))[0]?.reserved,
    ).toBe(2);
    const occupied = (
      await repo.listSeatingAssignments(owner.id, wedding.id, table.id)
    )[0]!;
    await expect(
      runtime.loveChapterRepository.updateGuest(
        owner.id,
        wedding.id,
        occupied.guestId,
        { allowedPartySize: 4 },
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      repo.saveSeatingTable(
        owner.id,
        wedding.id,
        table.id,
        { name: "A", capacity: 1 },
        false,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    await repo.assignSeating(owner.id, wedding.id, occupied.guestId, null);
    expect(
      (await repo.listSeatingTables(owner.id, wedding.id))[0]?.reserved,
    ).toBe(0);
  });

  it("rejects new assignments after a declined RSVP but keeps earlier reservations until unassigned", async () => {
    const { owner, wedding } = await fixture();
    const repo = runtime.operationsRepository;
    const table = await repo.saveSeatingTable(
      owner.id,
      wedding.id,
      crypto.randomUUID(),
      { name: "A", capacity: 2 },
      true,
    );
    const guest = await runtime.loveChapterRepository.createGuest(
      owner.id,
      wedding.id,
      crypto.randomUUID(),
      { name: "Mali", allowedPartySize: 2 },
    );
    const tokenHash = "f".repeat(64);
    await runtime.loveChapterRepository.createInvitation({
      id: crypto.randomUUID(),
      weddingId: wedding.id,
      guestId: guest.id,
      createdByUserId: owner.id,
      tokenHash,
    });
    await runtime.loveChapterRepository.upsertRsvp(
      tokenHash,
      crypto.randomUUID(),
      { attendance: "declined", partySize: 0 },
    );
    await expect(
      repo.assignSeating(owner.id, wedding.id, guest.id, table.id),
    ).rejects.toBeInstanceOf(ConflictError);
    await runtime.loveChapterRepository.upsertRsvp(
      tokenHash,
      crypto.randomUUID(),
      { attendance: "attending", partySize: 2 },
    );
    await repo.assignSeating(owner.id, wedding.id, guest.id, table.id);
    await runtime.loveChapterRepository.upsertRsvp(
      tokenHash,
      crypto.randomUUID(),
      { attendance: "declined", partySize: 0 },
    );
    expect(
      (await repo.listSeatingTables(owner.id, wedding.id))[0]?.reserved,
    ).toBe(2);
    await repo.assignSeating(owner.id, wedding.id, guest.id, null);
    expect(
      (await repo.listSeatingTables(owner.id, wedding.id))[0]?.reserved,
    ).toBe(0);
  });

  it("rechecks seating after waiting on a guest lock before changing party size", async () => {
    const { owner, wedding } = await fixture();
    const repo = runtime.operationsRepository;
    const table = await repo.saveSeatingTable(
      owner.id,
      wedding.id,
      crypto.randomUUID(),
      { name: "A", capacity: 2 },
      true,
    );
    const guest = await runtime.loveChapterRepository.createGuest(
      owner.id,
      wedding.id,
      crypto.randomUUID(),
      { name: "Mali", allowedPartySize: 2 },
    );
    const blocker = await runtime.pool.connect();
    let transactionOpen = false;
    try {
      await blocker.query("begin");
      transactionOpen = true;
      await blocker.query(
        "select id from guests where wedding_id = $1 and id = $2 for update",
        [wedding.id, guest.id],
      );
      const assigned = repo
        .assignSeating(owner.id, wedding.id, guest.id, table.id)
        .then(
          () => null,
          (error: unknown) => error,
        );
      const waiters = async (count: number) => {
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
          const result = await blocker.query<{ count: number }>(
            "select count(*)::int as count from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()",
          );
          if (result.rows[0]!.count >= count) return;
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        const activity = await blocker.query<{
          state: string;
          wait_event_type: string | null;
          query: string;
        }>(
          "select state, wait_event_type, left(query, 350) as query from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()",
        );
        throw new Error(
          `Expected ${count} guest lock waiter(s): ${JSON.stringify(activity.rows)}`,
        );
      };
      await waiters(1);
      const resized = runtime.loveChapterRepository
        .updateGuest(owner.id, wedding.id, guest.id, { allowedPartySize: 3 })
        .then(
          () => null,
          (error: unknown) => error,
        );
      await waiters(2);
      await blocker.query("commit");
      transactionOpen = false;
      expect(await assigned).toBeNull();
      expect(await resized).toBeInstanceOf(ConflictError);
      expect(
        (await repo.listSeatingTables(owner.id, wedding.id))[0]?.reserved,
      ).toBe(2);
    } finally {
      if (transactionOpen) await blocker.query("rollback");
      blocker.release();
    }
  }, 15000);
});
