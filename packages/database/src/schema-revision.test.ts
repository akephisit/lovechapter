import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { expectedSchemaMigrationHash } from "./schema-revision";

describe("deployed schema revision", () => {
  it("matches the latest checked-in Drizzle migration", () => {
    const journal = JSON.parse(
      readFileSync(
        new URL("../drizzle/meta/_journal.json", import.meta.url),
        "utf8",
      ),
    ) as { entries: Array<{ tag: string }> };
    const latest = journal.entries.at(-1)?.tag;
    expect(latest).toBeTruthy();
    const migration = readFileSync(
      new URL(`../drizzle/${latest}.sql`, import.meta.url),
    );
    expect(createHash("sha256").update(migration).digest("hex")).toBe(
      expectedSchemaMigrationHash,
    );
  });
});
