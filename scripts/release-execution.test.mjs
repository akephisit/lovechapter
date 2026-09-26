import { describe, expect, it, vi } from "vitest";

import { executeRelease } from "./release-execution.mjs";

const sha = "a".repeat(40);
const baselineSha = "b".repeat(40);
const previous = {
  web: { versionId: "web-old", sourceSha: baselineSha },
  api: { versionId: "api-old", sourceSha: baselineSha },
};

function fixture(environment = "staging") {
  const gateState = {
    mode: "open",
    targetSha: baselineSha,
    changedAt: "2026-09-26T06:00:00.000Z",
    activeCount: 0,
    ...previous,
  };
  const gate = { status: vi.fn(async () => gateState) };
  const ledger = {
    readProductionBaseline: vi.fn(async () => ({
      sha: baselineSha,
      ...previous,
    })),
  };
  const plan = {
    baselineSha,
    sha,
    impact: { web: true, backend: false, migrate: false },
    migration: { kind: "none", paths: [] },
  };
  const resolvePlan = vi.fn(async () => plan);
  const createDriver = vi.fn(() => ({ label: "guarded-driver" }));
  const runCutover = vi.fn(async () => ({ status: "released", sha }));
  return {
    environment,
    gateState,
    gate,
    ledger,
    plan,
    resolvePlan,
    createDriver,
    runCutover,
  };
}

describe("release execution from accepted baseline", () => {
  it("plans staging against its open gate Worker pair", async () => {
    const context = fixture();
    await expect(
      executeRelease({ environment: "staging", sha }, context),
    ).resolves.toEqual({
      status: "released",
      sha,
    });
    expect(context.resolvePlan).toHaveBeenCalledWith({ baselineSha, sha });
    expect(context.ledger.readProductionBaseline).not.toHaveBeenCalled();
    expect(context.createDriver).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: "staging",
        sha,
        impact: context.plan.impact,
        previous,
      }),
    );
    expect(context.runCutover).toHaveBeenCalledWith(
      {
        environment: "staging",
        sha,
        impact: context.plan.impact,
        migration: context.plan.migration,
      },
      { label: "guarded-driver" },
    );
  });

  it("requires GitHub's production ledger to agree with the open gate", async () => {
    const context = fixture("production");
    await executeRelease({ environment: "production", sha }, context);
    expect(context.ledger.readProductionBaseline).toHaveBeenCalledWith(
      context.gateState,
    );
    context.ledger.readProductionBaseline.mockResolvedValueOnce(null);
    await expect(
      executeRelease({ environment: "production", sha }, context),
    ).rejects.toThrow();
    expect(context.createDriver).toHaveBeenCalledTimes(1);
  });

  it("stops a closed, incomplete, or inconsistent baseline before planning", async () => {
    for (const edit of [
      { mode: "maintenance" },
      { targetSha: null },
      { web: null },
      { api: { versionId: "", sourceSha: baselineSha } },
    ]) {
      const context = fixture();
      context.gate.status.mockResolvedValueOnce({
        ...context.gateState,
        ...edit,
      });
      await expect(
        executeRelease({ environment: "staging", sha }, context),
      ).rejects.toThrow();
      expect(context.resolvePlan).not.toHaveBeenCalled();
      expect(context.createDriver).not.toHaveBeenCalled();
    }
  });

  it("does not create a driver or enter maintenance for documentation-only changes", async () => {
    const context = fixture();
    context.resolvePlan.mockResolvedValueOnce({
      ...context.plan,
      impact: { web: false, backend: false, migrate: false },
    });
    await expect(
      executeRelease({ environment: "staging", sha }, context),
    ).resolves.toEqual({
      status: "skipped",
      reason: "docs_only",
      sha,
    });
    expect(context.createDriver).not.toHaveBeenCalled();
    expect(context.runCutover).not.toHaveBeenCalled();
  });

  it("rejects a planner response for another SHA or baseline", async () => {
    for (const edit of [
      { sha: "c".repeat(40) },
      { baselineSha: "c".repeat(40) },
    ]) {
      const context = fixture();
      context.resolvePlan.mockResolvedValueOnce({ ...context.plan, ...edit });
      await expect(
        executeRelease({ environment: "staging", sha }, context),
      ).rejects.toThrow();
      expect(context.createDriver).not.toHaveBeenCalled();
    }
  });

  it("never treats an incomplete or contradictory plan as documentation-only", async () => {
    for (const edit of [
      { impact: { web: false, backend: false } },
      {
        impact: { web: false, backend: false, migrate: true },
        migration: { kind: "none", paths: [] },
      },
      { migration: { kind: "blocked", paths: ["migration.sql"] } },
    ]) {
      const context = fixture();
      context.resolvePlan.mockResolvedValueOnce({ ...context.plan, ...edit });
      await expect(
        executeRelease({ environment: "staging", sha }, context),
      ).rejects.toThrow();
      expect(context.createDriver).not.toHaveBeenCalled();
    }
  });
});
