import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

import { PostgresReleaseGateController } from "./release-gate-repository";

const connectionString = process.env.TEST_DATABASE_URL;
if (
  !connectionString ||
  process.env.TEST_DATABASE_CONFIRM !== "lovechapter_test" ||
  connectionString === process.env.DATABASE_URL
) {
  throw new Error("Production bootstrap test requires a disposable database");
}
const disposableUrl = new URL(connectionString);
const localDisposable =
  ["127.0.0.1", "localhost"].includes(disposableUrl.hostname) &&
  disposableUrl.pathname === "/lovechapter_test";

describe("first production Worker publication", () => {
  it.skipIf(!localDisposable)(
    "migrates retained 0010 data, opens both Workers, then selectively releases again",
    async () => {
      const fixtureName = `lovechapter_bootstrap_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const prefixDirectory = await mkdtemp(
        join(tmpdir(), "lovechapter-0010-"),
      );
      const admin = new Client({ connectionString });
      const fixtureUrl = new URL(connectionString);
      fixtureUrl.pathname = `/${fixtureName}`;
      let fixture: Client | undefined;
      let created = false;
      await admin.connect();
      try {
        await admin.query(`create database ${fixtureName}`);
        created = true;
        await mkdir(join(prefixDirectory, "meta"));
        const fullMigrations = new URL("../drizzle/", import.meta.url);
        const journal = JSON.parse(
          await readFile(new URL("meta/_journal.json", fullMigrations), "utf8"),
        ) as { entries: { tag: string }[] };
        const prefix = journal.entries.filter((entry) =>
          /^00(?:0[0-9]|10)_/u.test(entry.tag),
        );
        expect(prefix).toHaveLength(11);
        await writeFile(
          join(prefixDirectory, "meta/_journal.json"),
          JSON.stringify({ ...journal, entries: prefix }),
        );
        for (const entry of prefix) {
          await copyFile(
            new URL(`${entry.tag}.sql`, fullMigrations),
            join(prefixDirectory, `${entry.tag}.sql`),
          );
        }
        fixture = new Client({ connectionString: fixtureUrl.toString() });
        await fixture.connect();
        await migrate(drizzle({ client: fixture }), {
          migrationsFolder: prefixDirectory,
        });
        const retainedUserId = randomUUID();
        await fixture.query(
          `insert into users (id, auth_provider, auth_subject, display_name)
           values ($1, 'local', $2, 'Retained fixture')`,
          [retainedUserId, retainedUserId],
        );
        await migrate(drizzle({ client: fixture }), {
          migrationsFolder: fullMigrations.pathname,
        });
        const before = await fixture.query<{
          web_version_id: string | null;
          api_version_id: string | null;
        }>(
          "select web_version_id, api_version_id from ops.release_control where id = 1",
        );
        expect(before.rows).toEqual([
          { web_version_id: null, api_version_id: null },
        ]);
        const gate = new PostgresReleaseGateController(fixture);
        const firstSha = "a".repeat(40);
        const secondSha = "b".repeat(40);
        const first = {
          web: { versionId: "web-first", sourceSha: firstSha },
          api: { versionId: "api-first", sourceSha: firstSha },
        };
        await gate.closeFor(firstSha);
        const firstClosure = (await gate.status()).changedAt;
        expect(await gate.openFor(firstSha, firstClosure, first)).toBe(true);
        expect(await gate.status()).toMatchObject({
          mode: "open",
          targetSha: firstSha,
          ...first,
        });
        await gate.closeFor(secondSha);
        const secondClosure = (await gate.status()).changedAt;
        const second = {
          web: { versionId: "web-second", sourceSha: secondSha },
          api: first.api,
        };
        expect(await gate.openFor(secondSha, secondClosure, second)).toBe(true);
        expect(await gate.status()).toMatchObject({
          mode: "open",
          targetSha: secondSha,
          ...second,
        });
        const retained = await fixture.query<{ id: string }>(
          "select id from users where id = $1",
          [retainedUserId],
        );
        expect(retained.rows).toEqual([{ id: retainedUserId }]);
      } finally {
        await fixture?.end();
        if (created)
          await admin.query(`drop database ${fixtureName} with (force)`);
        await admin.end();
        await rm(prefixDirectory, { recursive: true, force: true });
      }
    },
    30_000,
  );
});
