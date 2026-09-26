import type {
  CreateGuestInput,
  GuestImportCommitResult,
  GuestImportMapping,
  GuestImportPreview,
  GuestImportPreviewRow,
  GuestImportTotals,
} from "@lovechapter/contracts";
import {
  ConflictError,
  encodeGuestImportCursor,
  NotFoundError,
  type GuestImportCandidateKey,
  type GuestImportDuplicateMatch,
  type GuestImportMappingState,
  type GuestImportRepository,
  type GuestImportStagedRow,
  type ReplaceGuestImportPreviewInput,
  type StageGuestImportInput,
} from "@lovechapter/domain";

import {
  buildGuestImportBatchQuery,
  buildCleanupExpiredGuestImportsQuery,
  buildGuestImportDuplicateLookupQuery,
  buildGuestImportPreviewQuery,
  buildInsertImportedAddressesQuery,
  buildInsertImportedGuestsQuery,
  buildInsertGuestImportRowsQuery,
  buildLoadGuestImportCommitRowsQuery,
  buildLoadGuestImportRowsQuery,
  buildMarkGuestImportCommittedQuery,
  buildReplaceGuestImportRowsQuery,
  buildStageGuestImportBatchQuery,
  buildUpdateGuestImportPreviewQuery,
  type ImportedAddressInsert,
  type ImportedGuestInsert,
} from "./guest-import-queries";
import type { QueryExecutor } from "./repository";

type Scope = { userId: string; weddingId: string; batchId: string };
type BatchRow = {
  id: string;
  headers: string[];
  mapping: GuestImportMapping;
  affiliation_mappings: Record<string, string>;
  preview_version: number;
  status: "previewed" | "committed";
  row_count: number;
  valid_count: number;
  warning_count: number;
  invalid_count: number;
  excluded_count: number;
  commit_idempotency_key: string | null;
  commit_result: unknown;
};
type PreviewRow = {
  id: string;
  row_number: number;
  candidate: CreateGuestInput | null;
  errors: string[];
  warnings: string[];
  included: boolean;
  source_values?: string[];
};
type SourceRow = {
  id: string;
  row_number: number;
  source_values: string[];
  included: boolean;
};

export class PostgresGuestImportRepository implements GuestImportRepository {
  constructor(private readonly executor: QueryExecutor) {}

  async cleanupExpiredGuestImports(input: {
    now: string;
    limit: 500;
  }): Promise<number> {
    const result = await this.executor.execute<{ id: string }>(
      buildCleanupExpiredGuestImportsQuery(input),
    );
    return result.rows.length;
  }

  async stageGuestImport(
    input: StageGuestImportInput,
  ): Promise<GuestImportPreview> {
    if (input.rows.length > 5000)
      throw new ConflictError("Guest import is too large");
    const totals = totalsFor(input.rows);
    return this.executor.transaction(async (transaction) => {
      const inserted = await transaction.execute<{ id: string }>(
        buildStageGuestImportBatchQuery({
          ...input,
          rowCount: input.rows.length,
          ...counts(totals),
        }),
      );
      if (!inserted.rows[0]) throw new NotFoundError("Wedding not found");
      const rows = await transaction.execute<{ id: string }>(
        buildInsertGuestImportRowsQuery({
          userId: input.userId,
          weddingId: input.weddingId,
          batchId: input.id,
          rows: input.rows,
        }),
      );
      if (rows.rows.length !== input.rows.length)
        throw new ConflictError("Guest import staging failed");
      return readPreview(
        transaction,
        { userId: input.userId, weddingId: input.weddingId, batchId: input.id },
        { limit: 100 },
      );
    });
  }

  async getGuestImport(
    userId: string,
    weddingId: string,
    batchId: string,
    page: { limit: number; cursor?: { rowNumber: number; id: string } },
  ): Promise<GuestImportPreview> {
    if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > 100)
      throw new ConflictError("Invalid preview page size");
    return this.executor.transaction((transaction) =>
      readPreview(transaction, { userId, weddingId, batchId }, page),
    );
  }

  async loadGuestImportForMapping(
    userId: string,
    weddingId: string,
    batchId: string,
  ): Promise<GuestImportMappingState> {
    return this.executor.transaction(async (transaction) => {
      const scope = { userId, weddingId, batchId };
      const batch = await requireBatch(transaction, scope, true);
      const source = await transaction.execute<SourceRow>(
        buildLoadGuestImportRowsQuery(scope),
      );
      if (source.rows.length !== Number(batch.row_count))
        throw new ConflictError("Guest import rows changed");
      return {
        batchId,
        headers: batch.headers,
        mapping: batch.mapping,
        affiliationMappings: batch.affiliation_mappings,
        mappingVersion: Number(batch.preview_version),
        status: batch.status,
        rows: source.rows.map((row) => ({
          id: row.id,
          rowNumber: row.row_number,
          values: row.source_values,
          included: row.included,
        })),
      };
    });
  }

  async findLikelyGuestDuplicates(
    userId: string,
    weddingId: string,
    candidates: GuestImportCandidateKey[],
  ): Promise<GuestImportDuplicateMatch[]> {
    if (candidates.length === 0) return [];
    if (candidates.length > 5000)
      throw new ConflictError("Guest import is too large");
    const result = await this.executor.execute<{
      row_id: string;
      kind: "email" | "name_phone";
    }>(buildGuestImportDuplicateLookupQuery({ userId, weddingId, candidates }));
    return result.rows.map((row) => ({ rowId: row.row_id, kind: row.kind }));
  }

  async replaceGuestImportPreview(
    input: ReplaceGuestImportPreviewInput,
  ): Promise<GuestImportPreview> {
    return this.executor.transaction(async (transaction) => {
      const scope = {
        userId: input.userId,
        weddingId: input.weddingId,
        batchId: input.batchId,
      };
      const batch = await requireBatch(transaction, scope, true);
      if (
        batch.status !== "previewed" ||
        Number(batch.preview_version) !== input.expectedVersion
      ) {
        throw new ConflictError("Guest import preview has changed");
      }
      if (
        input.rows.length !== Number(batch.row_count) ||
        new Set(input.rows.map((row) => row.id)).size !== input.rows.length
      ) {
        throw new ConflictError("Guest import row set has changed");
      }
      const updated = await transaction.execute<{ id: string }>(
        buildReplaceGuestImportRowsQuery({ ...scope, rows: input.rows }),
      );
      if (updated.rows.length !== input.rows.length)
        throw new ConflictError("Guest import row set has changed");
      const totals = totalsFor(input.rows);
      const version = await transaction.execute<{ id: string }>(
        buildUpdateGuestImportPreviewQuery({
          ...scope,
          expectedVersion: input.expectedVersion,
          mapping: input.mapping,
          affiliationMappings: input.affiliationMappings,
          ...counts(totals),
        }),
      );
      if (!version.rows[0])
        throw new ConflictError("Guest import preview has changed");
      return readPreview(transaction, scope, { limit: 100 });
    });
  }

  async commitGuestImport(input: {
    userId: string;
    weddingId: string;
    batchId: string;
    expectedVersion: number;
    includedRowIds: string[];
    createAnywayRowIds: string[];
    idempotencyKey: string;
  }): Promise<GuestImportCommitResult> {
    const scope = {
      userId: input.userId,
      weddingId: input.weddingId,
      batchId: input.batchId,
    };
    try {
      return await this.executor.transaction(async (transaction) => {
        const batch = await requireBatch(transaction, scope, true);
        if (batch.status === "committed") {
          if (
            batch.commit_idempotency_key !== input.idempotencyKey ||
            !batch.commit_result
          ) {
            throw new ConflictError("Guest import was already committed");
          }
          return batch.commit_result as GuestImportCommitResult;
        }
        if (Number(batch.preview_version) !== input.expectedVersion) {
          throw new ConflictError("Guest import preview has changed");
        }
        const loaded = await transaction.execute<PreviewRow>(
          buildLoadGuestImportCommitRowsQuery(scope),
        );
        if (loaded.rows.length !== Number(batch.row_count))
          throw new ConflictError("Guest import rows changed");
        const included = loaded.rows.filter((row) => row.included);
        const requested = new Set(input.includedRowIds);
        if (
          requested.size !== input.includedRowIds.length ||
          requested.size !== included.length ||
          included.some(
            (row) =>
              !requested.has(row.id) || row.errors.length > 0 || !row.candidate,
          )
        ) {
          throw new ConflictError(
            "Guest import selection is incomplete or invalid",
          );
        }
        const warned = new Set(
          included
            .filter((row) => row.warnings.length > 0)
            .map((row) => row.id),
        );
        const decisions = new Set(input.createAnywayRowIds);
        if (
          decisions.size !== input.createAnywayRowIds.length ||
          decisions.size !== warned.size ||
          [...warned].some((id) => !decisions.has(id))
        ) {
          throw new ConflictError(
            "Confirm every duplicate warning before import",
          );
        }
        const allocated = included.map((row) => ({
          guestId: crypto.randomUUID(),
          candidate: row.candidate!,
        }));
        for (let offset = 0; offset < allocated.length; offset += 1000) {
          const chunk = allocated.slice(offset, offset + 1000);
          const guests: ImportedGuestInsert[] = chunk.map(
            ({ guestId, candidate }) => ({
              id: guestId,
              name: candidate.name,
              email: candidate.email ?? null,
              phone: candidate.phone ?? null,
              allowedPartySize: candidate.allowedPartySize,
              affiliationId: candidate.affiliationId ?? null,
              envelopeName: candidate.envelopeName ?? null,
              note: candidate.note ?? null,
            }),
          );
          const result = await transaction.execute<{ id: string }>(
            buildInsertImportedGuestsQuery({ ...scope, guests }),
          );
          if (result.rows.length !== guests.length)
            throw new ConflictError("Guest import insertion was incomplete");
          const addresses: ImportedAddressInsert[] = chunk.flatMap(
            ({ guestId, candidate }) =>
              candidate.postalAddress
                ? [{ guestId, ...candidate.postalAddress }]
                : [],
          );
          if (addresses.length) {
            const result = await transaction.execute<{ id: string }>(
              buildInsertImportedAddressesQuery({ ...scope, addresses }),
            );
            if (result.rows.length !== addresses.length)
              throw new ConflictError(
                "Guest import address insertion was incomplete",
              );
          }
        }
        const result: GuestImportCommitResult = {
          created: allocated.length,
          excluded: Number(batch.row_count) - allocated.length,
          guestIds: allocated.map((row) => row.guestId),
        };
        const marked = await transaction.execute<{ id: string }>(
          buildMarkGuestImportCommittedQuery({
            ...scope,
            expectedVersion: input.expectedVersion,
            idempotencyKey: input.idempotencyKey,
            result,
          }),
        );
        if (!marked.rows[0])
          throw new ConflictError("Guest import preview has changed");
        return result;
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error.code === "23503" || error.code === "23505")
      ) {
        throw new ConflictError(
          "Guest import conflicts with current wedding data",
        );
      }
      throw error;
    }
  }
}

async function requireBatch(
  executor: QueryExecutor,
  scope: Scope,
  lock = false,
): Promise<BatchRow> {
  const result = await executor.execute<BatchRow>(
    buildGuestImportBatchQuery(scope, lock),
  );
  const batch = result.rows[0];
  if (!batch) throw new NotFoundError("Guest import not found");
  return batch;
}

async function readPreview(
  executor: QueryExecutor,
  scope: Scope,
  page: { limit: number; cursor?: { rowNumber: number; id: string } },
): Promise<GuestImportPreview> {
  const batch = await requireBatch(executor, scope, true);
  const result = await executor.execute<PreviewRow>(
    buildGuestImportPreviewQuery({ ...scope, ...page }),
  );
  const hasMore = result.rows.length > page.limit;
  const rows = hasMore ? result.rows.slice(0, page.limit) : result.rows;
  const last = rows.at(-1);
  return {
    batchId: batch.id,
    headers: batch.headers,
    mapping: batch.mapping,
    affiliationMappings: batch.affiliation_mappings,
    mappingVersion: Number(batch.preview_version),
    status: batch.status,
    totals: {
      valid: Number(batch.valid_count),
      warning: Number(batch.warning_count),
      invalid: Number(batch.invalid_count),
      excluded: Number(batch.excluded_count),
    },
    items: rows.map((row): GuestImportPreviewRow => ({
      id: row.id,
      rowNumber: Number(row.row_number),
      sourceName:
        batch.mapping.name === null
          ? null
          : row.source_values?.[batch.mapping.name]?.trim() || null,
      sourceAffiliation:
        batch.mapping.affiliation === null
          ? null
          : row.source_values?.[batch.mapping.affiliation]?.trim() || null,
      candidate: row.candidate,
      errors: row.errors,
      warnings: row.warnings,
      included: row.included,
    })),
    nextCursor:
      hasMore && last
        ? encodeGuestImportCursor(Number(last.row_number), last.id)
        : null,
  };
}

function totalsFor(rows: GuestImportStagedRow[]): GuestImportTotals {
  const totals = { valid: 0, warning: 0, invalid: 0, excluded: 0 };
  for (const row of rows) {
    if (!row.included) totals.excluded += 1;
    else if (row.errors.length) totals.invalid += 1;
    else if (row.warnings.length) totals.warning += 1;
    else totals.valid += 1;
  }
  return totals;
}

function counts(totals: GuestImportTotals) {
  return {
    validCount: totals.valid,
    warningCount: totals.warning,
    invalidCount: totals.invalid,
    excludedCount: totals.excluded,
  };
}
