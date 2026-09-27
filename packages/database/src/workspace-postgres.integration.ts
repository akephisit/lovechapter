import { NotFoundError } from "@lovechapter/domain";
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
    "Workspace integration requires a confirmed disposable TEST_DATABASE_URL",
  );
}
if (connectionString === process.env.DATABASE_URL) {
  throw new Error("TEST_DATABASE_URL must not reuse DATABASE_URL");
}

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

describe("PostgreSQL wedding workspace", () => {
  it("allows owner, couple, and planner to edit settings but not a collaborator or outsider", async () => {
    const repository = runtime.loveChapterRepository;
    const makeUser = async (displayName: string) =>
      repository.syncUser({
        provider: "development",
        subject: crypto.randomUUID(),
        displayName,
      });
    const owner = await makeUser("Owner");
    const couple = await makeUser("Couple");
    const planner = await makeUser("Planner");
    const collaborator = await makeUser("Collaborator");
    const outsider = await makeUser("Outsider");
    const wedding = await repository.createWedding(
      owner.id,
      crypto.randomUUID(),
      {
        name: "Original",
        weddingDate: "2027-02-14",
        timeZone: "UTC",
        locale: "en",
      },
    );
    for (const [user, role] of [
      [couple, "couple"],
      [planner, "planner"],
      [collaborator, "collaborator"],
    ] as const) {
      await runtime.pool.query(
        "insert into wedding_members (wedding_id,user_id,role) values ($1,$2,$3)",
        [wedding.id, user.id, role],
      );
    }
    for (const [user, role] of [
      [owner, "owner"],
      [couple, "couple"],
      [planner, "planner"],
    ] as const) {
      await expect(
        repository.updateWedding(user.id, wedding.id, {
          name: `${role} wedding`,
          weddingDate: null,
          timeZone: "Asia/Bangkok",
          locale: "th-TH",
        }),
      ).resolves.toMatchObject({
        name: `${role} wedding`,
        role,
        timeZone: "Asia/Bangkok",
        locale: "th-TH",
      });
    }
    const visible = await repository.listWeddings(collaborator.id, {
      limit: 20,
    });
    expect(visible.items).toMatchObject([
      { id: wedding.id, role: "collaborator" },
    ]);
    for (const user of [collaborator, outsider]) {
      await expect(
        repository.updateWedding(user.id, wedding.id, {
          name: "Unauthorized",
          weddingDate: null,
          timeZone: "UTC",
          locale: "en",
        }),
      ).rejects.toBeInstanceOf(NotFoundError);
    }
    await expect(
      repository.listWeddings(owner.id, { limit: 20 }),
    ).resolves.toMatchObject({
      items: [{ name: "planner wedding" }],
    });
  });

  it("counts only active guest parties and replaces a prior RSVP status", async () => {
    const repository = runtime.loveChapterRepository;
    const owner = await repository.syncUser({
      provider: "development",
      subject: crypto.randomUUID(),
      displayName: "Owner",
    });
    const outsider = await repository.syncUser({
      provider: "development",
      subject: crypto.randomUUID(),
      displayName: "Outsider",
    });
    const wedding = await repository.createWedding(
      owner.id,
      crypto.randomUUID(),
      {
        name: "Wedding",
        timeZone: "UTC",
        locale: "en",
      },
    );
    await expect(
      repository.getRsvpSummary(owner.id, wedding.id),
    ).resolves.toEqual({
      totalActive: 0,
      attending: 0,
      declined: 0,
      replied: 0,
      awaiting: 0,
    });
    const attending = await repository.createGuest(
      owner.id,
      wedding.id,
      crypto.randomUUID(),
      {
        name: "Attending party",
        allowedPartySize: 3,
      },
    );
    await repository.createGuest(owner.id, wedding.id, crypto.randomUUID(), {
      name: "Awaiting party",
      allowedPartySize: 1,
    });
    const archived = await repository.createGuest(
      owner.id,
      wedding.id,
      crypto.randomUUID(),
      {
        name: "Archived party",
        allowedPartySize: 1,
      },
    );
    for (const guest of [attending, archived]) {
      const tokenHash = crypto.randomUUID().replaceAll("-", "").padEnd(64, "0");
      await repository.createInvitation({
        id: crypto.randomUUID(),
        weddingId: wedding.id,
        guestId: guest.id,
        createdByUserId: owner.id,
        tokenHash,
      });
      await repository.upsertRsvp(tokenHash, crypto.randomUUID(), {
        attendance: "attending",
        partySize: 1,
      });
      if (guest.id === attending.id) {
        await repository.upsertRsvp(tokenHash, crypto.randomUUID(), {
          attendance: "declined",
          partySize: 0,
        });
      }
    }
    await repository.archiveGuest(owner.id, wedding.id, archived.id);
    await expect(
      repository.getRsvpSummary(owner.id, wedding.id),
    ).resolves.toEqual({
      totalActive: 2,
      attending: 0,
      declined: 1,
      replied: 1,
      awaiting: 1,
    });
    await expect(
      repository.getRsvpSummary(outsider.id, wedding.id),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
