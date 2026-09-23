import type {
  GuestImportCommitResult,
  GuestImportPreview,
  GuestImportPreviewRow,
  GuestImportTotals,
} from "@lovechapter/contracts";

import { decodeCursor } from "../cursor";
import { ConflictError, NotFoundError } from "../errors";
import { encodeGuestImportCursor } from "../guest-import";
import type {
  GuestImportCandidateKey,
  GuestImportDuplicateMatch,
  GuestImportMappingState,
  GuestImportRepository,
  GuestImportStagedRow,
  LoveChapterRepository,
  ReplaceGuestImportPreviewInput,
  StageGuestImportInput,
} from "../ports";

type Batch = Omit<StageGuestImportInput, "rows"> & {
  rows: GuestImportStagedRow[];
  version: number;
  status: "previewed" | "committed";
  commitKey?: string;
  commitResult?: GuestImportCommitResult;
};

export class InMemoryGuestImportRepository implements Pick<
  GuestImportRepository,
  | "stageGuestImport"
  | "getGuestImport"
  | "loadGuestImportForMapping"
  | "findLikelyGuestDuplicates"
  | "replaceGuestImportPreview"
  | "commitGuestImport"
> {
  private readonly batches = new Map<string, Batch>();
  constructor(private readonly guests: LoveChapterRepository) {}

  private async authorized(userId: string, weddingId: string) {
    await this.guests.listGuestAffiliations(userId, weddingId);
  }

  private async requireBatch(
    userId: string,
    weddingId: string,
    batchId: string,
  ): Promise<Batch> {
    await this.authorized(userId, weddingId);
    const batch = this.batches.get(`${weddingId}:${batchId}`);
    if (!batch || batch.expiresAt <= new Date().toISOString())
      throw new NotFoundError("Guest import not found");
    return batch;
  }

  async stageGuestImport(
    input: StageGuestImportInput,
  ): Promise<GuestImportPreview> {
    await this.authorized(input.userId, input.weddingId);
    this.batches.set(`${input.weddingId}:${input.id}`, {
      ...input,
      rows: input.rows.map((row) => ({ ...row })),
      version: 1,
      status: "previewed",
    });
    return this.getGuestImport(input.userId, input.weddingId, input.id, {
      limit: 100,
    });
  }

  async getGuestImport(
    userId: string,
    weddingId: string,
    batchId: string,
    page: { limit: number; cursor?: { rowNumber: number; id: string } },
  ): Promise<GuestImportPreview> {
    const batch = await this.requireBatch(userId, weddingId, batchId);
    const all = batch.rows.toSorted(
      (a, b) => a.rowNumber - b.rowNumber || a.id.localeCompare(b.id),
    );
    const filtered = page.cursor
      ? all.filter(
          (row) =>
            row.rowNumber > page.cursor!.rowNumber ||
            (row.rowNumber === page.cursor!.rowNumber &&
              row.id > page.cursor!.id),
        )
      : all;
    const window = filtered.slice(0, page.limit + 1);
    const items = window.slice(0, page.limit);
    const last = items.at(-1);
    return {
      batchId,
      headers: batch.headers,
      mapping: batch.mapping,
      affiliationMappings: batch.affiliationMappings,
      mappingVersion: batch.version,
      status: batch.status,
      totals: totalsFor(batch.rows),
      items: items.map((row): GuestImportPreviewRow => ({
        id: row.id,
        rowNumber: row.rowNumber,
        sourceName:
          batch.mapping.name === null
            ? null
            : row.values[batch.mapping.name]?.trim() || null,
        sourceAffiliation:
          batch.mapping.affiliation === null
            ? null
            : row.values[batch.mapping.affiliation]?.trim() || null,
        candidate: row.candidate,
        errors: row.errors,
        warnings: row.warnings,
        included: row.included,
      })),
      nextCursor:
        window.length > page.limit && last
          ? encodeGuestImportCursor(last.rowNumber, last.id)
          : null,
    };
  }

  async loadGuestImportForMapping(
    userId: string,
    weddingId: string,
    batchId: string,
  ): Promise<GuestImportMappingState> {
    const batch = await this.requireBatch(userId, weddingId, batchId);
    return {
      batchId,
      headers: batch.headers,
      mapping: batch.mapping,
      affiliationMappings: batch.affiliationMappings,
      mappingVersion: batch.version,
      status: batch.status,
      rows: batch.rows.map((row) => ({
        id: row.id,
        rowNumber: row.rowNumber,
        values: row.values,
        included: row.included,
      })),
    };
  }

  async findLikelyGuestDuplicates(
    userId: string,
    weddingId: string,
    candidates: GuestImportCandidateKey[],
  ): Promise<GuestImportDuplicateMatch[]> {
    await this.authorized(userId, weddingId);
    if (!candidates.length) return [];
    const matches: GuestImportDuplicateMatch[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.guests.listGuests(userId, weddingId, {
        limit: 100,
        view: "active",
        ...(cursor ? { cursor: decodeCursor(cursor) } : {}),
      });
      for (const guest of page.items)
        for (const key of candidates) {
          if (
            key.normalizedEmail &&
            guest.email?.toLocaleLowerCase() === key.normalizedEmail
          ) {
            matches.push({ rowId: key.rowId, kind: "email" });
          }
          if (
            key.normalizedPhone &&
            guest.name.toLocaleLowerCase() === key.normalizedName &&
            guest.phone === key.normalizedPhone
          ) {
            matches.push({ rowId: key.rowId, kind: "name_phone" });
          }
        }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return matches;
  }

  async replaceGuestImportPreview(
    input: ReplaceGuestImportPreviewInput,
  ): Promise<GuestImportPreview> {
    const batch = await this.requireBatch(
      input.userId,
      input.weddingId,
      input.batchId,
    );
    if (
      batch.status !== "previewed" ||
      batch.version !== input.expectedVersion ||
      batch.rows.length !== input.rows.length ||
      new Set(input.rows.map((row) => row.id)).size !== input.rows.length ||
      input.rows.some((row) => !batch.rows.some((old) => old.id === row.id))
    ) {
      throw new ConflictError("Guest import preview has changed");
    }
    batch.rows = input.rows.map((row) => ({ ...row }));
    batch.mapping = input.mapping;
    batch.affiliationMappings = input.affiliationMappings;
    batch.version += 1;
    return this.getGuestImport(input.userId, input.weddingId, input.batchId, {
      limit: 100,
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
    const batch = await this.requireBatch(
      input.userId,
      input.weddingId,
      input.batchId,
    );
    if (batch.status === "committed") {
      if (batch.commitKey !== input.idempotencyKey || !batch.commitResult) {
        throw new ConflictError("Guest import was already committed");
      }
      return batch.commitResult;
    }
    if (batch.version !== input.expectedVersion)
      throw new ConflictError("Guest import preview has changed");
    const included = batch.rows.filter((row) => row.included);
    const selected = new Set(input.includedRowIds);
    const warned = new Set(
      included.filter((row) => row.warnings.length).map((row) => row.id),
    );
    const decisions = new Set(input.createAnywayRowIds);
    if (
      selected.size !== input.includedRowIds.length ||
      selected.size !== included.length ||
      included.some(
        (row) => !selected.has(row.id) || row.errors.length || !row.candidate,
      ) ||
      decisions.size !== input.createAnywayRowIds.length ||
      decisions.size !== warned.size ||
      [...warned].some((id) => !decisions.has(id))
    ) {
      throw new ConflictError(
        "Guest import selection is incomplete or invalid",
      );
    }
    const guestIds: string[] = [];
    for (const row of included) {
      const id = crypto.randomUUID();
      await this.guests.createGuest(
        input.userId,
        input.weddingId,
        id,
        row.candidate!,
      );
      guestIds.push(id);
    }
    const result = {
      created: guestIds.length,
      excluded: batch.rows.length - guestIds.length,
      guestIds,
    };
    batch.status = "committed";
    batch.commitKey = input.idempotencyKey;
    batch.commitResult = result;
    return result;
  }
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
