import { DomainValidationError, NotFoundError } from "@lovechapter/domain";
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
      { limit: 20 },
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
      runtime.loveChapterRepository.setGuestAffiliation(
        owner.id,
        wedding.id,
        guest.id,
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
      { limit: 20 },
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
      { limit: 20 },
    );
    expect(guests.items).toEqual(
      creation.status === "fulfilled"
        ? [expect.objectContaining({ id: guestId, affiliation: null })]
        : [],
    );
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
