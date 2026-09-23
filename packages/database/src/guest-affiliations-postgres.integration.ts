import {
  decodeCursor,
  DomainValidationError,
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
) {
  throw new Error(
    "PostgreSQL integration tests require TEST_DATABASE_URL and TEST_DATABASE_CONFIRM=lovechapter_test",
  );
}
if (connectionString === process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must not reuse DATABASE_URL");
}

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

beforeEach(async () => {
  await runtime.pool.query("truncate users cascade");
});

afterAll(async () => {
  await runtime?.close();
});

describe("PostgreSQL guest affiliations", () => {
  it("keeps assignment and every mutation inside one wedding", async () => {
    const owner = await createUser("owner");
    const other = await createUser("other");
    const first = await createWedding(owner.id, "First wedding");
    const second = await createWedding(owner.id, "Second wedding");
    const affiliation =
      await runtime.loveChapterRepository.createGuestAffiliation(
        owner.id,
        first.id,
        crypto.randomUUID(),
        { name: "Family", color: "#a855f7" },
      );
    const guest = await runtime.loveChapterRepository.createGuest(
      owner.id,
      second.id,
      crypto.randomUUID(),
      { name: "Nok", allowedPartySize: 1 },
    );

    await expect(
      runtime.loveChapterRepository.createGuestAffiliation(
        other.id,
        first.id,
        crypto.randomUUID(),
        { name: "Unauthorized", color: "#475569" },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      runtime.loveChapterRepository.updateGuestAffiliation(
        owner.id,
        second.id,
        affiliation.id,
        { name: "Wrong wedding", color: "#475569" },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      runtime.loveChapterRepository.reorderGuestAffiliations(
        owner.id,
        second.id,
        [affiliation.id],
      ),
    ).rejects.toBeInstanceOf(DomainValidationError);
    await expect(
      runtime.loveChapterRepository.deleteGuestAffiliation(
        owner.id,
        second.id,
        affiliation.id,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      runtime.loveChapterRepository.setGuestAffiliation(
        owner.id,
        second.id,
        guest.id,
        affiliation.id,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("deletes an affiliation sequentially and preserves assigned guests", async () => {
    const owner = await createUser("delete");
    const wedding = await createWedding(owner.id, "Delete safely");
    const affiliation =
      await runtime.loveChapterRepository.createGuestAffiliation(
        owner.id,
        wedding.id,
        crypto.randomUUID(),
        { name: "Work", color: "#475569" },
      );
    const guest = await runtime.loveChapterRepository.createGuest(
      owner.id,
      wedding.id,
      crypto.randomUUID(),
      {
        name: "Nok",
        allowedPartySize: 1,
        affiliationId: affiliation.id,
      },
    );

    await runtime.loveChapterRepository.deleteGuestAffiliation(
      owner.id,
      wedding.id,
      affiliation.id,
    );

    await expect(
      runtime.loveChapterRepository.listGuestAffiliations(owner.id, wedding.id),
    ).resolves.toEqual([]);
    const guests = await runtime.loveChapterRepository.listGuests(
      owner.id,
      wedding.id,
      { limit: 20, view: "active" },
    );
    expect(guests.items).toEqual([
      expect.objectContaining({ id: guest.id, affiliation: null }),
    ]);
  });

  it("serializes concurrent creates at the 100-affiliation limit", async () => {
    const owner = await createUser("limit");
    const wedding = await createWedding(owner.id, "Bounded affiliations");
    const ids = Array.from({ length: 99 }, () => crypto.randomUUID());
    await runtime.pool.query(
      `insert into guest_affiliations
        (id, wedding_id, name, color, sort_order)
       select source.id, $2, 'Affiliation ' || source.ordinality, '#a855f7',
         (source.ordinality - 1)::integer
       from unnest($1::uuid[]) with ordinality as source(id, ordinality)`,
      [ids, wedding.id],
    );

    const outcomes = await Promise.allSettled([
      runtime.loveChapterRepository.createGuestAffiliation(
        owner.id,
        wedding.id,
        crypto.randomUUID(),
        { name: "Concurrent A", color: "#0ea5e9" },
      ),
      runtime.loveChapterRepository.createGuestAffiliation(
        owner.id,
        wedding.id,
        crypto.randomUUID(),
        { name: "Concurrent B", color: "#db2777" },
      ),
    ]);

    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === "rejected");
    expect(rejected?.reason).toBeInstanceOf(DomainValidationError);
    const count = await runtime.pool.query<{ count: string }>(
      "select count(*) from guest_affiliations where wedding_id = $1",
      [wedding.id],
    );
    expect(count.rows[0]?.count).toBe("100");
  });

  it("leaves a guest unassigned when assignment races deletion", async () => {
    const owner = await createUser("race");
    const wedding = await createWedding(owner.id, "Concurrent delete");
    const affiliation =
      await runtime.loveChapterRepository.createGuestAffiliation(
        owner.id,
        wedding.id,
        crypto.randomUUID(),
        { name: "Friends", color: "#0ea5e9" },
      );
    const guest = await runtime.loveChapterRepository.createGuest(
      owner.id,
      wedding.id,
      crypto.randomUUID(),
      { name: "Dao", allowedPartySize: 1 },
    );

    const [assignment, deletion] = await Promise.allSettled([
      runtime.loveChapterRepository.bulkSetGuestAffiliation(
        owner.id,
        wedding.id,
        [guest.id],
        affiliation.id,
      ),
      runtime.loveChapterRepository.deleteGuestAffiliation(
        owner.id,
        wedding.id,
        affiliation.id,
      ),
    ]);

    expect(deletion.status).toBe("fulfilled");
    if (assignment.status === "rejected") {
      expect(assignment.reason).toBeInstanceOf(NotFoundError);
    }

    const guests = await runtime.loveChapterRepository.listGuests(
      owner.id,
      wedding.id,
      { limit: 20, view: "active" },
    );
    expect(guests.items).toEqual([
      expect.objectContaining({ id: guest.id, affiliation: null }),
    ]);
    await expect(
      runtime.loveChapterRepository.listGuestAffiliations(owner.id, wedding.id),
    ).resolves.toEqual([]);
  });

  it("normalizes assigned-guest creation when it races deletion", async () => {
    const owner = await createUser("create-race");
    const wedding = await createWedding(owner.id, "Concurrent guest create");
    const affiliation =
      await runtime.loveChapterRepository.createGuestAffiliation(
        owner.id,
        wedding.id,
        crypto.randomUUID(),
        { name: "Family", color: "#a855f7" },
      );
    const guestId = crypto.randomUUID();

    const [creation, deletion] = await Promise.allSettled([
      runtime.loveChapterRepository.createGuest(owner.id, wedding.id, guestId, {
        name: "Nok",
        allowedPartySize: 1,
        affiliationId: affiliation.id,
      }),
      runtime.loveChapterRepository.deleteGuestAffiliation(
        owner.id,
        wedding.id,
        affiliation.id,
      ),
    ]);

    expect(deletion.status).toBe("fulfilled");
    if (creation.status === "rejected") {
      expect(creation.reason).toBeInstanceOf(NotFoundError);
    }
    await expect(
      runtime.loveChapterRepository.listGuestAffiliations(owner.id, wedding.id),
    ).resolves.toEqual([]);
    const guests = await runtime.loveChapterRepository.listGuests(
      owner.id,
      wedding.id,
      { limit: 20, view: "active" },
    );
    expect(guests.items).toEqual(
      creation.status === "fulfilled"
        ? [expect.objectContaining({ id: guestId, affiliation: null })]
        : [],
    );
  });
});

describe("PostgreSQL guest management", () => {
  it("exports the same active/archived and affiliation-filtered order without crossing tenants", async () => {
    const owner = await createUser("export-owner");
    const outsider = await createUser("export-outsider");
    const wedding = await createWedding(owner.id, "Export scope");
    const affiliation =
      await runtime.loveChapterRepository.createGuestAffiliation(
        owner.id,
        wedding.id,
        crypto.randomUUID(),
        { name: "Family", color: "#a855f7" },
      );
    const assigned = await runtime.loveChapterRepository.createGuest(
      owner.id,
      wedding.id,
      crypto.randomUUID(),
      { name: "Som", allowedPartySize: 1, affiliationId: affiliation.id },
    );
    const unassigned = await runtime.loveChapterRepository.createGuest(
      owner.id,
      wedding.id,
      crypto.randomUUID(),
      { name: "Som two", allowedPartySize: 1 },
    );
    await runtime.loveChapterRepository.archiveGuest(
      owner.id,
      wedding.id,
      assigned.id,
    );
    for (const filter of [
      { view: "active" as const, affiliation: "unassigned" },
      { view: "archived" as const, affiliation: affiliation.id },
    ]) {
      const list = await runtime.loveChapterRepository.listGuests(
        owner.id,
        wedding.id,
        { ...filter, search: "Som", limit: 20 },
      );
      const exported = await runtime.loveChapterRepository.listGuestExportPage(
        owner.id,
        wedding.id,
        { ...filter, search: "Som", limit: 500 },
      );
      expect(exported.items.map((row) => row.cursorId)).toEqual(
        list.items.map((guest) => guest.id),
      );
      expect(exported.items.map((row) => row.name)).toEqual(
        list.items.map((guest) => guest.name),
      );
    }
    const active = await runtime.loveChapterRepository.listGuestExportPage(
      owner.id,
      wedding.id,
      { view: "active", limit: 500 },
    );
    expect(active.items.map((row) => row.cursorId)).toEqual([unassigned.id]);
    await expect(
      runtime.loveChapterRepository.listGuestExportPage(
        outsider.id,
        wedding.id,
        { view: "active", limit: 500 },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
  it("keeps guest detail and mutations inside an authorized wedding", async () => {
    const owner = await createUser("guest-owner");
    const outsider = await createUser("guest-outsider");
    const wedding = await createWedding(owner.id, "Private guests");
    const guest = await runtime.loveChapterRepository.createGuest(
      owner.id,
      wedding.id,
      crypto.randomUUID(),
      { name: "Nok", allowedPartySize: 1 },
    );

    await expect(
      runtime.loveChapterRepository.getGuest(outsider.id, wedding.id, guest.id),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      runtime.loveChapterRepository.updateGuest(
        outsider.id,
        wedding.id,
        guest.id,
        { name: "Leaked" },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      runtime.loveChapterRepository.archiveGuest(
        outsider.id,
        wedding.id,
        guest.id,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      runtime.loveChapterRepository.restoreGuest(
        outsider.id,
        wedding.id,
        guest.id,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("revokes archived invitations permanently across restore", async () => {
    const owner = await createUser("archive-owner");
    const wedding = await createWedding(owner.id, "Archive guests");
    const guest = await runtime.loveChapterRepository.createGuest(
      owner.id,
      wedding.id,
      crypto.randomUUID(),
      { name: "Dao", allowedPartySize: 1 },
    );
    const tokenHash = "a".repeat(64);
    const invitation = await runtime.loveChapterRepository.createInvitation({
      id: crypto.randomUUID(),
      weddingId: wedding.id,
      guestId: guest.id,
      createdByUserId: owner.id,
      tokenHash,
    });

    await runtime.loveChapterRepository.archiveGuest(
      owner.id,
      wedding.id,
      guest.id,
    );
    await expect(
      runtime.loveChapterRepository.findPublicInvitation(tokenHash),
    ).resolves.toBeNull();
    await runtime.loveChapterRepository.restoreGuest(
      owner.id,
      wedding.id,
      guest.id,
    );
    const persisted = await runtime.pool.query<{ revoked_at: Date | null }>(
      "select revoked_at from invitations where id = $1",
      [invitation.id],
    );
    expect(persisted.rows[0]?.revoked_at).not.toBeNull();
    await expect(
      runtime.loveChapterRepository.findPublicInvitation(tokenHash),
    ).resolves.toBeNull();
  });

  it("serializes invitation creation behind archive and keeps the restored guest invitation-free", async () => {
    const owner = await createUser("race-owner");
    const wedding = await createWedding(owner.id, "Archive race");
    const guest = await runtime.loveChapterRepository.createGuest(
      owner.id,
      wedding.id,
      crypto.randomUUID(),
      { name: "Dao", allowedPartySize: 1 },
    );
    const blocker = await runtime.pool.connect();
    let archive!: ReturnType<typeof runtime.loveChapterRepository.archiveGuest>;
    let creation!: ReturnType<
      typeof runtime.loveChapterRepository.createInvitation
    >;
    try {
      await blocker.query("begin");
      await blocker.query("update guests set name = name where id = $1", [
        guest.id,
      ]);
      archive = runtime.loveChapterRepository.archiveGuest(
        owner.id,
        wedding.id,
        guest.id,
      );
      void archive.catch(() => {});
      let archiveWaiting = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const result = await runtime.pool.query<{ waiting: boolean }>(
          `select exists (
            select 1 from pg_stat_activity
            where wait_event_type = 'Lock' and query like 'update "guests"%'
          ) as waiting`,
        );
        if (result.rows[0]?.waiting) {
          archiveWaiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(archiveWaiting).toBe(true);
      const tokenHash = "e".repeat(64);
      creation = runtime.loveChapterRepository.createInvitation({
        id: crypto.randomUUID(),
        weddingId: wedding.id,
        guestId: guest.id,
        createdByUserId: owner.id,
        tokenHash,
      });
      void creation.catch(() => {});
      await blocker.query("rollback");
      await archive;
      await expect(creation).rejects.toBeInstanceOf(NotFoundError);
      await runtime.loveChapterRepository.restoreGuest(
        owner.id,
        wedding.id,
        guest.id,
      );
      await expect(
        runtime.loveChapterRepository.findPublicInvitation(tokenHash),
      ).resolves.toBeNull();
    } finally {
      await blocker.query("rollback").catch(() => {});
      blocker.release();
    }
  });

  it("rejects a mixed-wedding bulk archive without partial changes", async () => {
    const owner = await createUser("bulk-owner");
    const first = await createWedding(owner.id, "First bulk wedding");
    const second = await createWedding(owner.id, "Second bulk wedding");
    const local = await runtime.loveChapterRepository.createGuest(
      owner.id,
      first.id,
      crypto.randomUUID(),
      { name: "Local", allowedPartySize: 1 },
    );
    const foreign = await runtime.loveChapterRepository.createGuest(
      owner.id,
      second.id,
      crypto.randomUUID(),
      { name: "Foreign", allowedPartySize: 1 },
    );

    await expect(
      runtime.loveChapterRepository.bulkArchiveGuests(owner.id, first.id, [
        local.id,
        foreign.id,
      ]),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      runtime.loveChapterRepository.getGuest(owner.id, first.id, local.id),
    ).resolves.not.toHaveProperty("archivedAt");
  });

  it("traverses equal-timestamp filtered pages without duplicates or skips", async () => {
    const owner = await createUser("cursor-owner");
    const wedding = await createWedding(owner.id, "Cursor wedding");
    const guests = await Promise.all(
      ["Same A", "Same B", "Same C"].map((name) =>
        runtime.loveChapterRepository.createGuest(
          owner.id,
          wedding.id,
          crypto.randomUUID(),
          { name, allowedPartySize: 1 },
        ),
      ),
    );
    await runtime.pool.query(
      "update guests set created_at = '2026-09-23T00:00:00.000Z' where wedding_id = $1",
      [wedding.id],
    );

    const first = await runtime.loveChapterRepository.listGuests(
      owner.id,
      wedding.id,
      { limit: 2, view: "active", search: "Same", rsvp: "pending" },
    );
    expect(first.nextCursor).not.toBeNull();
    expect(first.items[1]?.createdAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    if (!first.nextCursor) throw new Error("Expected a second guest page");
    const second = await runtime.loveChapterRepository.listGuests(
      owner.id,
      wedding.id,
      {
        limit: 2,
        view: "active",
        search: "Same",
        rsvp: "pending",
        cursor: decodeCursor(first.nextCursor),
      },
    );
    expect(
      new Set([...first.items, ...second.items].map((guest) => guest.id)),
    ).toEqual(new Set(guests.map((guest) => guest.id)));
  });
});

async function createUser(subject: string) {
  return runtime.loveChapterRepository.syncUser({
    provider: "development",
    subject: `integration-${subject}`,
    displayName: subject,
    email: `${subject}@example.test`,
  });
}

async function createWedding(userId: string, name: string) {
  return runtime.loveChapterRepository.createWedding(
    userId,
    crypto.randomUUID(),
    { name, timeZone: "UTC", locale: "en" },
  );
}
