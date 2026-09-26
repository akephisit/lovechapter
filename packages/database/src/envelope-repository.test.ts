import type { EnvelopeTemplateInput } from "@lovechapter/contracts";
import { ConflictError, NotFoundError } from "@lovechapter/domain";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { PostgresEnvelopeRepository } from "./envelope-repository";
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
const scope = { userId: crypto.randomUUID(), weddingId: crypto.randomUUID() };
const template: EnvelopeTemplateInput = {
  name: "DL",
  widthMm: 220,
  heightMm: 110,
  orientation: "landscape",
  marginTopMm: 10,
  marginRightMm: 10,
  marginBottomMm: 10,
  marginLeftMm: 10,
  alignment: "center",
  fontFamily: "noto-sans-thai",
  fontSizePt: 18,
  lineSpacingPercent: 120,
  showAddress: false,
};
describe("PostgresEnvelopeRepository", () => {
  it("returns empty authorized lists and normalizes database timestamps", async () => {
    const at = new Date("2026-09-23T00:00:00.000Z");
    const values = {
      id: crypto.randomUUID(),
      name: "DL",
      width_mm: 220,
      height_mm: 110,
      orientation: "landscape",
      margin_top_mm: 10,
      margin_right_mm: 10,
      margin_bottom_mm: 10,
      margin_left_mm: 10,
      alignment: "center",
      font_family: "noto-sans-thai",
      font_size_pt: 18,
      line_spacing_percent: 120,
      show_address: false,
      created_at: at,
      updated_at: at,
    };
    const executor = new FakeExecutor([[{ id: scope.weddingId }], [values]]);
    await expect(
      new PostgresEnvelopeRepository(executor).listEnvelopeTemplates(
        scope.userId,
        scope.weddingId,
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        createdAt: at.toISOString(),
        updatedAt: at.toISOString(),
      }),
    ]);
  });
  it("rejects unbounded direct print requests before querying", async () => {
    const executor = new FakeExecutor([]);
    await expect(
      new PostgresEnvelopeRepository(executor).getEnvelopePrintData(
        scope.userId,
        scope.weddingId,
        {
          guestIds: Array.from({ length: 501 }, () => crypto.randomUUID()),
          template,
        },
      ),
    ).rejects.toThrow();
    expect(executor.queries).toHaveLength(0);
  });
  it("does not create a template without authorized wedding lock", async () => {
    const executor = new FakeExecutor([[]]);
    await expect(
      new PostgresEnvelopeRepository(executor).createEnvelopeTemplate(
        scope.userId,
        scope.weddingId,
        crypto.randomUUID(),
        template,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(executor.queries).toHaveLength(1);
  });
  it("caps wedding templates at 50 under the lock", async () => {
    const executor = new FakeExecutor([
      [{ id: scope.weddingId }],
      Array(50).fill({ id: crypto.randomUUID() }),
    ]);
    await expect(
      new PostgresEnvelopeRepository(executor).createEnvelopeTemplate(
        scope.userId,
        scope.weddingId,
        crypto.randomUUID(),
        template,
      ),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(executor.queries).toHaveLength(2);
  });
  it("rejects partial/missing/archived print guest results", async () => {
    const executor = new FakeExecutor([[]]);
    await expect(
      new PostgresEnvelopeRepository(executor).getEnvelopePrintData(
        scope.userId,
        scope.weddingId,
        {
          guestIds: [crypto.randomUUID()],
          template,
        },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
  it("returns print guests in requested order with optional addresses", async () => {
    const ids = [crypto.randomUUID(), crypto.randomUUID()];
    const executor = new FakeExecutor([
      [
        { id: ids[0], envelope_name: "Nok", address_line_1: null },
        {
          id: ids[1],
          envelope_name: "Dao",
          address_line_1: "123 Lane",
          address_line_2: null,
          locality: null,
          administrative_area: null,
          postal_code: null,
          country_code: null,
        },
      ],
    ]);
    await expect(
      new PostgresEnvelopeRepository(executor).getEnvelopePrintData(
        scope.userId,
        scope.weddingId,
        {
          guestIds: ids,
          template,
        },
      ),
    ).resolves.toEqual({
      template,
      guests: [
        { id: ids[0], envelopeName: "Nok", postalAddress: null },
        {
          id: ids[1],
          envelopeName: "Dao",
          postalAddress: { addressLine1: "123 Lane" },
        },
      ],
    });
  });
});
