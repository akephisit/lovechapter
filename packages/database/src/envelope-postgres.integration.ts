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
    "PostgreSQL integration tests require TEST_DATABASE_URL and TEST_DATABASE_CONFIRM=lovechapter_test",
  );
}
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

const template = {
  name: "DL",
  widthMm: 220,
  heightMm: 110,
  orientation: "landscape" as const,
  marginTopMm: 10,
  marginRightMm: 10,
  marginBottomMm: 10,
  marginLeftMm: 10,
  alignment: "center" as const,
  fontFamily: "noto-sans-thai" as const,
  fontSizePt: 18,
  lineSpacingPercent: 120,
  showAddress: false,
};
async function fixture() {
  const owner = await runtime.loveChapterRepository.syncUser({
    provider: "development",
    subject: crypto.randomUUID(),
    displayName: "Owner",
  });
  const wedding = await runtime.loveChapterRepository.createWedding(
    owner.id,
    crypto.randomUUID(),
    { name: "Wedding", timeZone: "UTC", locale: "en" },
  );
  return { owner, wedding };
}
describe("PostgreSQL envelope printing isolation", () => {
  it("separates templates and rejects cross-wedding, missing and archived guests", async () => {
    const { owner, wedding } = await fixture();
    const other = await runtime.loveChapterRepository.createWedding(
      owner.id,
      crypto.randomUUID(),
      { name: "Other", timeZone: "UTC", locale: "en" },
    );
    const saved = await runtime.envelopeRepository.createEnvelopeTemplate(
      owner.id,
      wedding.id,
      crypto.randomUUID(),
      template,
    );
    const guest = await runtime.loveChapterRepository.createGuest(
      owner.id,
      wedding.id,
      crypto.randomUUID(),
      { name: "Nok", allowedPartySize: 1 },
    );
    await expect(
      runtime.envelopeRepository.getEnvelopePrintData(owner.id, other.id, {
        guestIds: [guest.id],
        templateId: saved.id,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      runtime.envelopeRepository.getEnvelopePrintData(owner.id, wedding.id, {
        guestIds: [crypto.randomUUID()],
        template,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      await runtime.envelopeRepository.getEnvelopePrintData(
        owner.id,
        wedding.id,
        { guestIds: [guest.id], template },
      ),
    ).toMatchObject({
      guests: [{ id: guest.id, envelopeName: "Nok", postalAddress: null }],
    });
    await runtime.loveChapterRepository.archiveGuest(
      owner.id,
      wedding.id,
      guest.id,
    );
    await expect(
      runtime.envelopeRepository.getEnvelopePrintData(owner.id, wedding.id, {
        guestIds: [guest.id],
        template,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
  it("preserves request order and loads 500 guests in one query", async () => {
    const { owner, wedding } = await fixture();
    const ids = Array.from({ length: 500 }, () => crypto.randomUUID());
    await runtime.pool.query(
      `insert into guests (id, wedding_id, name, allowed_party_size)
       select source.id, $2, 'Guest ' || source.ordinality, 1
       from unnest($1::uuid[]) with ordinality as source(id, ordinality)`,
      [ids, wedding.id],
    );
    const requested = ids.toReversed();
    const data = await runtime.envelopeRepository.getEnvelopePrintData(
      owner.id,
      wedding.id,
      { guestIds: requested, template },
    );
    expect(data.guests.map((guest) => guest.id)).toEqual(requested);
  });
});
