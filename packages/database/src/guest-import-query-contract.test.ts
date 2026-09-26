import { PgDialect } from "drizzle-orm/pg-core";
import { autoMapGuestHeaders } from "@lovechapter/domain";
import { describe, expect, it } from "vitest";

import {
  buildStageGuestImportBatchQuery,
  buildInsertGuestImportRowsQuery,
  buildGuestImportPreviewQuery,
  buildGuestImportDuplicateLookupQuery,
  buildReplaceGuestImportRowsQuery,
  buildLoadGuestImportCommitRowsQuery,
  buildInsertImportedGuestsQuery,
  buildInsertImportedAddressesQuery,
  buildMarkGuestImportCommittedQuery,
  buildCleanupExpiredGuestImportsQuery,
} from "./guest-import-queries";

const dialect = new PgDialect();
const userId = "018f0000-0000-7000-8000-000000000001";
const weddingId = "018f0000-0000-7000-8000-000000000002";
const batchId = "018f0000-0000-7000-8000-000000000003";

describe("guest import SQL boundaries", () => {
  it("deletes at most 500 expired batches in deterministic order with cascading rows", () => {
    const query = dialect.sqlToQuery(
      buildCleanupExpiredGuestImportsQuery({
        now: "2026-09-25T00:00:00.000Z",
        limit: 500,
      }),
    );
    expect(query.sql).toMatch(/order by .*"expires_at".*"wedding_id".*"id"/i);
    expect(query.sql).toMatch(/limit \$\d+/i);
    expect(query.sql).toMatch(/delete from "guest_import_batches"/i);
    expect(query.sql).toMatch(/skip locked/i);
    expect(query.params).toContain(500);
  });
  it("loads commit rows and inserts guest/address chunks in one authorized set-based transaction", () => {
    const scope = { userId, weddingId, batchId };
    const rows = dialect.sqlToQuery(buildLoadGuestImportCommitRowsQuery(scope));
    const inserted = dialect.sqlToQuery(
      buildInsertImportedGuestsQuery({
        ...scope,
        guests: [
          {
            id: crypto.randomUUID(),
            name: "Nok",
            email: null,
            phone: null,
            allowedPartySize: 1,
            affiliationId: null,
            envelopeName: null,
            note: null,
          },
        ],
      }),
    );
    const addresses = dialect.sqlToQuery(
      buildInsertImportedAddressesQuery({
        ...scope,
        addresses: [{ guestId: crypto.randomUUID(), addressLine1: "123 Lane" }],
      }),
    );
    const marked = dialect.sqlToQuery(
      buildMarkGuestImportCommittedQuery({
        ...scope,
        expectedVersion: 1,
        idempotencyKey: "retry-key",
        result: { created: 1, excluded: 0, guestIds: [] },
      }),
    );
    for (const query of [rows, inserted, addresses, marked]) {
      expect(query.sql).toMatch(/"wedding_members"/i);
      expect(query.params).toEqual(expect.arrayContaining([userId, weddingId]));
      expect(query.sql).not.toMatch(/select\s+\*/i);
    }
    expect(rows.sql).toMatch(/limit 5001/i);
    expect(inserted.sql).toMatch(/jsonb_to_recordset/i);
    expect(addresses.sql).toMatch(/jsonb_to_recordset/i);
    expect(inserted.sql).not.toContain("Nok");
    expect(marked.sql).toMatch(/"preview_version" = \$\d+/i);
  });
  it("stages a batch and rows through authorized set-based SQL", () => {
    const batch = dialect.sqlToQuery(
      buildStageGuestImportBatchQuery({
        id: batchId,
        userId,
        weddingId,
        sourceSha256: "a".repeat(64),
        headers: ["name"],
        mapping: autoMapGuestHeaders(["name"]),
        affiliationMappings: {},
        rowCount: 1,
        validCount: 1,
        warningCount: 0,
        invalidCount: 0,
        excludedCount: 0,
        expiresAt: "2026-09-24T00:00:00.000Z",
      }),
    );
    const insert = dialect.sqlToQuery(
      buildInsertGuestImportRowsQuery({
        userId,
        weddingId,
        batchId,
        rows: [
          {
            id: crypto.randomUUID(),
            rowNumber: 2,
            values: ["Nok"],
            candidate: { name: "Nok", allowedPartySize: 1 },
            errors: [],
            warnings: [],
            included: true,
          },
        ],
      }),
    );
    for (const query of [batch, insert]) {
      expect(query.sql).toMatch(/"wedding_members"/i);
      expect(query.params).toEqual(expect.arrayContaining([userId, weddingId]));
      expect(query.sql).not.toMatch(/select\s+\*/i);
    }
    expect(insert.sql).toMatch(/jsonb_to_recordset/i);
    expect(insert.sql).not.toContain("Nok");
  });

  it("pages previews, finds active duplicates, and replaces mapped rows within tenant scope", () => {
    const preview = dialect.sqlToQuery(
      buildGuestImportPreviewQuery({ userId, weddingId, batchId, limit: 100 }),
    );
    const duplicates = dialect.sqlToQuery(
      buildGuestImportDuplicateLookupQuery({
        userId,
        weddingId,
        candidates: [
          {
            rowId: crypto.randomUUID(),
            normalizedEmail: "nok@example.test",
            normalizedName: "nok",
            normalizedPhone: "123",
          },
        ],
      }),
    );
    const replacement = dialect.sqlToQuery(
      buildReplaceGuestImportRowsQuery({
        userId,
        weddingId,
        batchId,
        rows: [],
      }),
    );
    for (const query of [preview, duplicates, replacement]) {
      expect(query.sql).toMatch(/"wedding_members"/i);
      expect(query.params).toEqual(expect.arrayContaining([userId, weddingId]));
    }
    expect(preview.sql).toMatch(/order by .*"row_number" asc.*"id" asc/i);
    expect(preview.params).toContain(101);
    expect(duplicates.sql).toMatch(/"archived_at" is null/i);
    expect(duplicates.sql).toMatch(/jsonb_to_recordset/i);
    expect(replacement.sql).toMatch(/jsonb_to_recordset/i);
  });
});
