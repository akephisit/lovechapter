import { describe, expect, it } from "vitest";

import { DomainValidationError } from "./errors";
import {
  normalizePlanningTaskCreate,
  normalizePlanningTaskPatch,
} from "./planning";

describe("planning task inputs", () => {
  it("keeps a real calendar date and normalizes optional text", () => {
    expect(
      normalizePlanningTaskCreate({
        title: "  Book venue  ",
        category: "  Venue  ",
        note: "  Ask about access  ",
        dueDate: "2028-02-29",
      }),
    ).toEqual({
      title: "Book venue",
      category: "Venue",
      note: "Ask about access",
      dueDate: "2028-02-29",
    });
  });

  it("rejects impossible dates, blank titles and oversized Unicode input", () => {
    for (const input of [
      { title: "Flowers", dueDate: "2027-02-29" },
      { title: "Flowers", dueDate: "2026-04-31" },
      { title: "    " },
      { title: "🎉".repeat(181) },
    ]) {
      expect(() => normalizePlanningTaskCreate(input)).toThrow(
        DomainValidationError,
      );
    }
  });

  it("allows clearing optional fields and independently changing completion", () => {
    expect(
      normalizePlanningTaskPatch({
        category: null,
        dueDate: null,
        completed: true,
      }),
    ).toEqual({ category: null, dueDate: null, completed: true });
    expect(() => normalizePlanningTaskPatch({})).toThrow(DomainValidationError);
    expect(() => normalizePlanningTaskPatch({ title: "  " })).toThrow(
      DomainValidationError,
    );
  });
});
