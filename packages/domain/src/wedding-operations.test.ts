import { describe, expect, it } from "vitest";

import {
  normalizeBudget,
  normalizeBudgetCategory,
  normalizeExpense,
  normalizeRunSheetItem,
  normalizeSeatingTable,
  normalizeVendor,
  parseMoney,
  resolveWeddingLocalTime,
} from "./wedding-operations";

describe("wedding operations validation", () => {
  it("stores currency amounts as integer minor units without rounding", () => {
    expect(parseMoney("123.45", "USD")).toBe(12345);
    expect(parseMoney("123", "JPY")).toBe(123);
    expect(parseMoney("0.001", "KWD")).toBe(1);
    expect(() => parseMoney("0.001", "USD")).toThrow();
    expect(() => parseMoney("-1", "USD")).toThrow();
    expect(() => parseMoney("900719925474099.99", "USD")).toThrow();
    expect(() => parseMoney("100", "INVALID")).toThrow();
  });

  it("keeps wedding-defined names and validates budget details", () => {
    expect(normalizeBudget({ currency: "eur", targetMinor: 20000 })).toEqual({
      currency: "EUR",
      targetMinor: 20000,
    });
    expect(normalizeBudgetCategory({ name: "  Flowers " })).toEqual({
      name: "Flowers",
    });
    expect(() =>
      normalizeBudget({ currency: "USD", targetMinor: -1 }),
    ).toThrow();
    expect(() => normalizeBudgetCategory({ name: "  " })).toThrow();
  });

  it("validates planned versus paid cost, dates and optional associations", () => {
    expect(
      normalizeExpense({
        title: "  Venue  ",
        plannedMinor: 5000,
        paidMinor: 1000,
        dueDate: "2026-12-19",
        categoryId: null,
        vendorId: null,
      }),
    ).toMatchObject({ title: "Venue", dueDate: "2026-12-19" });
    expect(() =>
      normalizeExpense({
        title: "Catering",
        plannedMinor: 100,
        paidMinor: 101,
      }),
    ).toThrow();
    expect(() =>
      normalizeExpense({
        title: "Catering",
        plannedMinor: 100,
        paidMinor: 0,
        dueDate: "2026-02-30",
      }),
    ).toThrow();
  });

  it("validates vendor statuses and quote amounts", () => {
    expect(
      normalizeVendor({
        name: "  Studio  ",
        status: "booked",
        quoteMinor: 12000,
      }),
    ).toMatchObject({
      name: "Studio",
      status: "booked",
      quoteMinor: 12000,
    });
    expect(() =>
      normalizeVendor({ name: "Studio", status: "unknown" as "booked" }),
    ).toThrow();
  });

  it("accepts ordered instants and positive seating capacity", () => {
    expect(
      normalizeRunSheetItem({
        title: "Ceremony",
        startsAt: "2026-12-19T02:00:00.000Z",
        endsAt: "2026-12-19T03:00:00.000Z",
      }),
    ).toMatchObject({ title: "Ceremony" });
    expect(() =>
      normalizeRunSheetItem({
        title: "Late",
        startsAt: "2026-12-19T03:00:00Z",
        endsAt: "2026-12-19T02:00:00Z",
      }),
    ).toThrow();
    expect(() =>
      normalizeRunSheetItem({
        title: "Impossible",
        startsAt: "2026-02-30T09:00:00Z",
        endsAt: "2026-02-30T10:00:00Z",
      }),
    ).toThrow();
    expect(normalizeSeatingTable({ name: "  A  ", capacity: 8 })).toEqual({
      name: "A",
      capacity: 8,
    });
    expect(() => normalizeSeatingTable({ name: "A", capacity: 0 })).toThrow();
  });

  it("rejects nonexistent or ambiguous local wedding times", () => {
    expect(resolveWeddingLocalTime("2026-12-19T09:30", "Asia/Bangkok")).toBe(
      "2026-12-19T02:30:00.000Z",
    );
    expect(() =>
      resolveWeddingLocalTime("2026-03-08T02:30", "America/New_York"),
    ).toThrow();
    expect(() =>
      resolveWeddingLocalTime("2026-11-01T01:30", "America/New_York"),
    ).toThrow();
  });
});
