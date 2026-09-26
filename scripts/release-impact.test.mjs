import { describe, expect, it } from "vitest";

import {
  classifyReleaseImpact,
  createReleasePlan,
  parseGitChanges,
} from "./release-impact.mjs";

const modified = (...paths) => paths.map((path) => ({ status: "M", path }));

describe("parseGitChanges", () => {
  it("preserves statuses for NUL-delimited Git changes", () => {
    expect(
      parseGitChanges("M\0packages/database/src/schema.ts\0D\0old.sql\0"),
    ).toEqual([
      { status: "M", path: "packages/database/src/schema.ts" },
      { status: "D", path: "old.sql" },
    ]);
  });

  it("rejects incomplete status/path pairs", () => {
    expect(() => parseGitChanges("M\0schema.ts\0D\0")).toThrow(
      "Expected Git change status/path pairs",
    );
  });
});

describe("classifyReleaseImpact", () => {
  it("deploys only the web for a frontend-only change", () => {
    expect(
      classifyReleaseImpact(
        modified("apps/web/components/couple-workspace.tsx"),
      ),
    ).toEqual({
      web: true,
      backend: false,
      migrate: false,
    });
  });

  it("deploys only the selected backend for API and job changes", () => {
    expect(
      classifyReleaseImpact(
        modified("apps/api/src/app.ts", "apps/jobs/src/processor.ts"),
      ),
    ).toEqual({ web: false, backend: true, migrate: false });
  });

  it("plans both components for a migration that could break their shared contract", () => {
    expect(
      classifyReleaseImpact(
        modified("packages/database/drizzle/0009_example.sql"),
      ),
    ).toEqual({
      web: true,
      backend: true,
      migrate: true,
    });
  });

  it("blocks a schema source change without a SQL migration", () => {
    expect(() =>
      classifyReleaseImpact(modified("packages/database/src/schema.ts")),
    ).toThrow("Schema source changed without a SQL migration");
    expect(() =>
      classifyReleaseImpact(
        modified(
          "packages/database/src/schema.ts",
          "packages/database/drizzle/meta/_journal.json",
        ),
      ),
    ).toThrow("Schema source changed without a SQL migration");
  });

  it("does not count a deleted SQL migration for a schema source change", () => {
    expect(() =>
      classifyReleaseImpact([
        { status: "M", path: "packages/database/src/schema.ts" },
        { status: "D", path: "packages/database/drizzle/0009_example.sql" },
      ]),
    ).toThrow("Schema source changed without a SQL migration");
  });

  it("plans both components and migration review when schema and SQL change together", () => {
    expect(
      classifyReleaseImpact(
        modified(
          "packages/database/src/schema.ts",
          "packages/database/drizzle/0009_example.sql",
        ),
      ),
    ).toEqual({ web: true, backend: true, migrate: true });
  });

  it("accepts an added SQL migration for a schema source change", () => {
    expect(
      classifyReleaseImpact([
        { status: "M", path: "packages/database/src/schema.ts" },
        { status: "A", path: "packages/database/drizzle/0010_example.sql" },
      ]),
    ).toEqual({ web: true, backend: true, migrate: true });
  });

  it("builds and deploys both consumers after shared contract changes", () => {
    expect(
      classifyReleaseImpact(modified("packages/contracts/src/index.ts")),
    ).toEqual({
      web: true,
      backend: true,
      migrate: false,
    });
  });

  it("skips deployments for documentation-only changes", () => {
    expect(
      classifyReleaseImpact(modified("docs/PROGRESS.md", "README.md")),
    ).toEqual({
      web: false,
      backend: false,
      migrate: false,
    });
  });

  it("does not deploy for a migration review document alone", () => {
    expect(
      classifyReleaseImpact([
        {
          status: "A",
          path: "packages/database/drizzle/reviews/0011_example.md",
        },
      ]),
    ).toEqual({ web: false, backend: false, migrate: false });
  });

  it("treats unfamiliar source paths as affecting both deployments", () => {
    expect(classifyReleaseImpact(modified("new-app/src/index.ts"))).toEqual({
      web: true,
      backend: true,
      migrate: false,
    });
  });
});

describe("createReleasePlan", () => {
  it.each(["worker", "bun-vps"])(
    "selects exactly one %s backend",
    (runtime) => {
      expect(
        createReleasePlan(modified("apps/api/src/app.ts"), runtime),
      ).toEqual({
        web: false,
        backend: true,
        migrate: false,
        backendRuntime: runtime,
      });
    },
  );

  it.each([undefined, "worker,bun-vps", "both", ""])(
    "rejects ambiguous runtime %s",
    (runtime) => {
      expect(() =>
        createReleasePlan(modified("apps/api/src/app.ts"), runtime),
      ).toThrow("Select exactly one backend runtime");
    },
  );
});
