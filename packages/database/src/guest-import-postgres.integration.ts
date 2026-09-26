import {
  autoMapGuestHeaders,
  ConflictError,
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

async function fixture(count: number, invalidIndex = -1) {
  const user = await runtime.loveChapterRepository.syncUser({
    provider: "development",
    subject: crypto.randomUUID(),
    displayName: "Import owner",
    email: `${crypto.randomUUID()}@example.test`,
  });
  const wedding = await runtime.loveChapterRepository.createWedding(
    user.id,
    crypto.randomUUID(),
    {
      name: "Import wedding",
      timeZone: "UTC",
      locale: "en",
    },
  );
  const batchId = crypto.randomUUID();
  const rows = Array.from({ length: count }, (_, index) => ({
    id: crypto.randomUUID(),
    rowNumber: index + 2,
    values: [`Guest ${index}`],
    candidate:
      index === invalidIndex
        ? null
        : {
            name: `Guest ${index}`,
            allowedPartySize: 1,
            postalAddress: { addressLine1: `${index} Main Street` },
          },
    errors: index === invalidIndex ? ["Invalid name"] : [],
    warnings: [],
    included: true,
  }));
  await runtime.guestImportRepository.stageGuestImport({
    id: batchId,
    userId: user.id,
    weddingId: wedding.id,
    sourceSha256: "a".repeat(64),
    headers: ["name"],
    mapping: autoMapGuestHeaders(["name"]),
    affiliationMappings: {},
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    rows,
  });
  const input = {
    userId: user.id,
    weddingId: wedding.id,
    batchId,
    expectedVersion: 1,
    includedRowIds: rows.map((row) => row.id),
    createAnywayRowIds: [],
    idempotencyKey: crypto.randomUUID(),
  };
  return { user, wedding, rows, input };
}

describe("PostgreSQL guest import commit", () => {
  it("rejects a cross-wedding batch without creating guests", async () => {
    const { user, input } = await fixture(1);
    const other = await runtime.loveChapterRepository.createWedding(
      user.id,
      crypto.randomUUID(),
      {
        name: "Other",
        timeZone: "UTC",
        locale: "en",
      },
    );
    await expect(
      runtime.guestImportRepository.commitGuestImport({
        ...input,
        weddingId: other.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const count = await runtime.pool.query<{ count: string }>(
      "select count(*) from guests",
    );
    expect(count.rows[0]?.count).toBe("0");
  });

  it("rolls back all guests and addresses when any included row is invalid", async () => {
    const { input } = await fixture(2, 1);
    await expect(
      runtime.guestImportRepository.commitGuestImport(input),
    ).rejects.toBeInstanceOf(ConflictError);
    const guests = await runtime.pool.query<{ count: string }>(
      "select count(*) from guests",
    );
    const addresses = await runtime.pool.query<{ count: string }>(
      "select count(*) from guest_postal_addresses",
    );
    expect([guests.rows[0]?.count, addresses.rows[0]?.count]).toEqual([
      "0",
      "0",
    ]);
  });

  it("inserts 2,001 guests and addresses atomically across three chunks", async () => {
    const { input } = await fixture(2001);
    const result = await runtime.guestImportRepository.commitGuestImport(input);
    expect(result).toMatchObject({ created: 2001, excluded: 0 });
    expect(new Set(result.guestIds).size).toBe(2001);
    const guests = await runtime.pool.query<{ count: string }>(
      "select count(*) from guests",
    );
    const addresses = await runtime.pool.query<{ count: string }>(
      "select count(*) from guest_postal_addresses",
    );
    expect([guests.rows[0]?.count, addresses.rows[0]?.count]).toEqual([
      "2001",
      "2001",
    ]);
  });

  it("serializes mapping changes with commit and rejects a stale version", async () => {
    const { rows, input } = await fixture(1);
    const outcomes = await Promise.allSettled([
      runtime.guestImportRepository.commitGuestImport(input),
      runtime.guestImportRepository.replaceGuestImportPreview({
        userId: input.userId,
        weddingId: input.weddingId,
        batchId: input.batchId,
        expectedVersion: 1,
        mapping: autoMapGuestHeaders(["name"]),
        affiliationMappings: {},
        rows,
      }),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.find((outcome) => outcome.status === "rejected")?.reason,
    ).toBeInstanceOf(ConflictError);
    const guests = await runtime.pool.query<{ count: string }>(
      "select count(*) from guests",
    );
    expect(["0", "1"]).toContain(guests.rows[0]?.count);
  });

  it("returns the same saved result for concurrent same-key calls and rejects a later different key", async () => {
    const { input } = await fixture(1);
    const [first, second] = await Promise.all([
      runtime.guestImportRepository.commitGuestImport(input),
      runtime.guestImportRepository.commitGuestImport(input),
    ]);
    expect(first).toEqual(second);
    await expect(
      runtime.guestImportRepository.commitGuestImport({
        ...input,
        idempotencyKey: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    const guests = await runtime.pool.query<{ count: string }>(
      "select count(*) from guests",
    );
    expect(guests.rows[0]?.count).toBe("1");
  });
});
