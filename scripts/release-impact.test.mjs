import { describe, expect, it } from "vitest";

import { classifyReleaseImpact, createReleasePlan } from "./release-impact.mjs";

describe("classifyReleaseImpact", () => {
  it("deploys only the web for a frontend-only change", () => {
    expect(
      classifyReleaseImpact(["apps/web/components/couple-workspace.tsx"]),
    ).toEqual({
      web: true,
      backend: false,
      migrate: false,
    });
  });

  it("deploys only the selected backend for API and job changes", () => {
    expect(
      classifyReleaseImpact([
        "apps/api/src/app.ts",
        "apps/jobs/src/processor.ts",
      ]),
    ).toEqual({ web: false, backend: true, migrate: false });
  });

  it("plans both components for a migration that could break their shared contract", () => {
    expect(
      classifyReleaseImpact(["packages/database/drizzle/0009_example.sql"]),
    ).toEqual({
      web: true,
      backend: true,
      migrate: true,
    });
  });

  it("blocks a schema source change without a SQL migration", () => {
    expect(() =>
      classifyReleaseImpact(["packages/database/src/schema.ts"]),
    ).toThrow("Schema source changed without a SQL migration");
    expect(() =>
      classifyReleaseImpact([
        "packages/database/src/schema.ts",
        "packages/database/drizzle/meta/_journal.json",
      ]),
    ).toThrow("Schema source changed without a SQL migration");
  });

  it("plans both components and migration review when schema and SQL change together", () => {
    expect(
      classifyReleaseImpact([
        "packages/database/src/schema.ts",
        "packages/database/drizzle/0009_example.sql",
      ]),
    ).toEqual({ web: true, backend: true, migrate: true });
  });

  it("builds and deploys both consumers after shared contract changes", () => {
    expect(classifyReleaseImpact(["packages/contracts/src/index.ts"])).toEqual({
      web: true,
      backend: true,
      migrate: false,
    });
  });

  it("skips deployments for documentation-only changes", () => {
    expect(classifyReleaseImpact(["docs/PROGRESS.md", "README.md"])).toEqual({
      web: false,
      backend: false,
      migrate: false,
    });
  });

  it("treats unfamiliar source paths as affecting both deployments", () => {
    expect(classifyReleaseImpact(["new-app/src/index.ts"])).toEqual({
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
      expect(createReleasePlan(["apps/api/src/app.ts"], runtime)).toEqual({
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
      expect(() => createReleasePlan(["apps/api/src/app.ts"], runtime)).toThrow(
        "Select exactly one backend runtime",
      );
    },
  );
});
