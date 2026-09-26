import { describe, expect, it } from "vitest";

import { validateMigrationReviews } from "./migration-review.mjs";

const sqlPath = "packages/database/drizzle/0011_example.sql";
const reviewPath = "packages/database/drizzle/reviews/0011_example.md";
const review = `## Classification
breaking: no
data_deletion: no

## Data transformation
Retain all rows.

## Locking and query effects
Bounded index change.

## Validation
Check row counts and query plans.

## Recovery
Restore the isolated checkpoint if needed.
`;

describe("validateMigrationReviews", () => {
  it("returns none without a SQL migration", async () => {
    expect(
      await validateMigrationReviews(
        [{ status: "A", path: reviewPath }],
        async () => {
          throw new Error("must not read a review for docs-only changes");
        },
      ),
    ).toEqual({ kind: "none", paths: [] });
  });

  it("requires the matching review for each added SQL migration", async () => {
    expect(
      await validateMigrationReviews(
        [{ status: "A", path: sqlPath }],
        async (path) => {
          expect(path).toBe(reviewPath);
          return review;
        },
      ),
    ).toEqual({ kind: "nonbreaking", paths: [sqlPath] });
  });

  it("rejects a missing or empty required section", async () => {
    await expect(
      validateMigrationReviews([{ status: "M", path: sqlPath }], async () =>
        review.replace("Retain all rows.", ""),
      ),
    ).rejects.toThrow("Data transformation");
    await expect(
      validateMigrationReviews([{ status: "M", path: sqlPath }], async () =>
        review.replace("## Recovery", "## Unrelated"),
      ),
    ).rejects.toThrow("Recovery");
  });

  it("rejects unknown classification values", async () => {
    await expect(
      validateMigrationReviews([{ status: "A", path: sqlPath }], async () =>
        review.replace("breaking: no", "breaking: maybe"),
      ),
    ).rejects.toThrow("breaking");
    await expect(
      validateMigrationReviews([{ status: "A", path: sqlPath }], async () =>
        review.replace("data_deletion: no", "data_deletion: unknown"),
      ),
    ).rejects.toThrow("data_deletion");
  });

  it("blocks automatic release for declared data deletion", async () => {
    expect(
      await validateMigrationReviews([{ status: "A", path: sqlPath }], () =>
        Promise.resolve(
          review.replace("data_deletion: no", "data_deletion: yes"),
        ),
      ),
    ).toEqual({ kind: "blocked", paths: [sqlPath] });
  });

  it("classifies a reviewed breaking migration", async () => {
    expect(
      await validateMigrationReviews([{ status: "A", path: sqlPath }], () =>
        Promise.resolve(review.replace("breaking: no", "breaking: yes")),
      ),
    ).toEqual({ kind: "breaking", paths: [sqlPath] });
  });

  it("blocks a deleted migration instead of treating it as no migration", async () => {
    expect(
      await validateMigrationReviews(
        [{ status: "D", path: sqlPath }],
        async () => {
          throw new Error("deleted SQL must not read a review");
        },
      ),
    ).toEqual({ kind: "blocked", paths: [sqlPath] });
  });
});
