import { describe, expect, it } from "vitest";

import { assertScryptBudget, summarizeDurations } from "./scrypt-benchmark";

describe("scrypt benchmark reporting", () => {
  it("uses nearest-rank percentiles for the production budget", () => {
    expect(summarizeDurations([100, 200, 300, 400, 500])).toEqual({
      p50Ms: 300,
      p95Ms: 500,
      maxMs: 500,
    });
  });

  it("rejects slow or over-concurrent production results", () => {
    expect(() => assertScryptBudget({ p95Ms: 751, maxConcurrent: 2 })).toThrow(
      "750 ms",
    );
    expect(() => assertScryptBudget({ p95Ms: 750, maxConcurrent: 3 })).toThrow(
      "at most 2",
    );
    expect(() =>
      assertScryptBudget({ p95Ms: 750, maxConcurrent: 2 }),
    ).not.toThrow();
  });
});
