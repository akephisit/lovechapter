import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildEnvelopePrintGuestsQuery,
  buildListEnvelopeTemplatesQuery,
  buildLockEnvelopeWeddingQuery,
} from "./envelope-queries";

const dialect = new PgDialect();
const scope = { userId: crypto.randomUUID(), weddingId: crypto.randomUUID() };
describe("envelope SQL tenant boundary", () => {
  it("scopes template listing and creation lock to membership", () => {
    for (const sql of [
      buildListEnvelopeTemplatesQuery(scope),
      buildLockEnvelopeWeddingQuery(scope),
    ]) {
      const query = dialect.sqlToQuery(sql);
      expect(query.sql).toMatch(/"wedding_members"/);
      expect(query.params).toEqual(
        expect.arrayContaining([scope.userId, scope.weddingId]),
      );
    }
  });
  it("reads ordered active guests and optional addresses in one bounded query", () => {
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    const query = dialect.sqlToQuery(
      buildEnvelopePrintGuestsQuery({ ...scope, guestIds: ids }),
    );
    expect(query.sql).toMatch(/unnest\(\$\d+::uuid\[\]\) with ordinality/i);
    expect(query.sql).toMatch(/"archived_at" is null/i);
    expect(query.sql).toMatch(/left join "guest_postal_addresses"/i);
    expect(query.sql).toMatch(/coalesce\(nullif/i);
    expect(query.sql).toMatch(/order by .*ordinality/i);
    expect(query.params).toEqual(
      expect.arrayContaining([scope.userId, scope.weddingId, ids]),
    );
  });
});
