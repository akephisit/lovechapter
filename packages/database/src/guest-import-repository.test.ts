import {
  autoMapGuestHeaders,
  ConflictError,
  NotFoundError,
} from "@lovechapter/domain";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { PostgresGuestImportRepository } from "./guest-import-repository";
import type { QueryExecutor } from "./repository";

class FakeExecutor implements QueryExecutor {
  readonly queries: SQL[] = [];
  constructor(private readonly results: Array<Record<string, unknown>[]>) {}
  async execute<T extends Record<string, unknown>>(
    query: SQL,
  ): Promise<{ rows: T[] }> {
    this.queries.push(query);
    return { rows: (this.results.shift() ?? []) as T[] };
  }
  async transaction<T>(
    operation: (executor: QueryExecutor) => Promise<T>,
  ): Promise<T> {
    return operation(this);
  }
}

const userId = "018f0000-0000-7000-8000-000000000001";
const weddingId = "018f0000-0000-7000-8000-000000000002";
const batchId = "018f0000-0000-7000-8000-000000000003";
const rowId = "018f0000-0000-7000-8000-000000000004";
const batch = {
  id: batchId,
  headers: ["name"],
  mapping: autoMapGuestHeaders(["name"]),
  affiliation_mappings: {},
  preview_version: 1,
  status: "previewed",
  row_count: 1,
  valid_count: 1,
  warning_count: 0,
  invalid_count: 0,
  excluded_count: 0,
  commit_idempotency_key: null,
  commit_result: null,
};
const row = {
  id: rowId,
  row_number: 2,
  candidate: { name: "Nok", allowedPartySize: 1 },
  errors: [],
  warnings: [],
  included: true,
  source_values: ["Nok"],
};

describe("PostgresGuestImportRepository", () => {
  it("stages a batch and all its rows atomically before returning bounded preview", async () => {
    const executor = new FakeExecutor([
      [{ id: batchId }],
      [{ id: rowId }],
      [batch],
      [row],
    ]);
    const repository = new PostgresGuestImportRepository(executor);
    const result = await repository.stageGuestImport({
      id: batchId,
      userId,
      weddingId,
      sourceSha256: "a".repeat(64),
      headers: ["name"],
      mapping: autoMapGuestHeaders(["name"]),
      affiliationMappings: {},
      expiresAt: "2026-09-24T00:00:00.000Z",
      rows: [
        {
          id: rowId,
          rowNumber: 2,
          values: ["Nok"],
          candidate: row.candidate,
          errors: [],
          warnings: [],
          included: true,
        },
      ],
    });
    expect(result).toMatchObject({
      batchId,
      mappingVersion: 1,
      totals: { valid: 1 },
      items: [{ id: rowId, candidate: row.candidate }],
    });
    expect(executor.queries).toHaveLength(4);
  });

  it("does not reveal a missing or unauthorized batch", async () => {
    const repository = new PostgresGuestImportRepository(
      new FakeExecutor([[]]),
    );
    await expect(
      repository.getGuestImport(userId, weddingId, batchId, { limit: 100 }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects a stale mapping version before any row is modified", async () => {
    const executor = new FakeExecutor([[{ ...batch, preview_version: 2 }]]);
    const repository = new PostgresGuestImportRepository(executor);
    await expect(
      repository.replaceGuestImportPreview({
        userId,
        weddingId,
        batchId,
        expectedVersion: 1,
        mapping: batch.mapping,
        affiliationMappings: {},
        rows: [
          {
            id: rowId,
            rowNumber: 2,
            values: ["Nok"],
            candidate: row.candidate,
            errors: [],
            warnings: [],
            included: true,
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(executor.queries).toHaveLength(1);
  });

  it("replays a committed batch only for the same key, without another insert", async () => {
    const saved = { created: 1, excluded: 0, guestIds: [crypto.randomUUID()] };
    const executor = new FakeExecutor([
      [
        {
          ...batch,
          status: "committed",
          commit_idempotency_key: "retry",
          commit_result: saved,
        },
      ],
    ]);
    const repository = new PostgresGuestImportRepository(executor);
    const input = {
      userId,
      weddingId,
      batchId,
      expectedVersion: 1,
      includedRowIds: [rowId],
      createAnywayRowIds: [],
      idempotencyKey: "retry",
    };
    await expect(repository.commitGuestImport(input)).resolves.toEqual(saved);
    expect(executor.queries).toHaveLength(1);
  });

  it("rejects incomplete inclusion or unacknowledged warnings before inserting", async () => {
    const warned = { ...row, warnings: ["Likely existing guest email"] };
    const executor = new FakeExecutor([[batch], [warned]]);
    const repository = new PostgresGuestImportRepository(executor);
    await expect(
      repository.commitGuestImport({
        userId,
        weddingId,
        batchId,
        expectedVersion: 1,
        includedRowIds: [rowId],
        createAnywayRowIds: [],
        idempotencyKey: "retry",
      }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(executor.queries).toHaveLength(2);
  });
});
