import { describe, expect, it, vi } from "vitest";

import { runCutover } from "./release-orchestrator.mjs";

const sha = "a".repeat(40);
const prior = "b".repeat(40);
function fixture(overrides = {}) {
  const events = [];
  const method = (name, value) =>
    vi.fn(async (...args) => {
      events.push([name, ...args]);
      if (overrides.fail === name) throw new Error(`${name} failed`);
      return overrides.values?.[name] ?? value;
    });
  const deployed = {
    web: { versionId: "web-version", sourceSha: sha },
    api: { versionId: "api-version", sourceSha: sha },
  };
  const driver = {
    readMainHead: method("readMainHead", sha),
    verifyProduction: method("verifyProduction", {
      releaseEnabled: true,
      protectedMain: true,
      baseline: { expectedSha: prior, currentSha: prior },
      targetVerified: true,
    }),
    prepare: method("prepare", { sha, artifact: "prepared" }),
    close: method("close", {
      mode: "maintenance",
      targetSha: sha,
      changedAt: "2026-09-26T00:00:00.000Z",
    }),
    drain: method("drain", {
      mode: "maintenance",
      targetSha: sha,
      activeCount: 0,
    }),
    migrate: method("migrate", { status: "applied_and_validated" }),
    createRecoveryPoint: method("createRecoveryPoint", {
      snapshotId: "snap-one",
      sourceBranchId: "br-production",
    }),
    deploy: method("deploy", deployed),
    privateSmoke: method("privateSmoke", {
      passed: true,
      acceptedAt: "2026-09-26T00:01:00.000Z",
    }),
    open: method("open", {
      mode: "open",
      targetSha: sha,
      ...deployed,
    }),
    publicCheck: method("publicCheck", { passed: true }),
    reclose: method("reclose", { mode: "maintenance", targetSha: sha }),
    record: method("record", { deploymentId: 42 }),
  };
  return { driver, events };
}

const input = {
  environment: "production",
  sha,
  impact: { web: true, backend: true, migrate: false },
  migration: { kind: "none", paths: [] },
};

describe("serial Worker cutover", () => {
  it("prepares before closing and opens only after drain, deploy, and private smoke", async () => {
    const { driver, events } = fixture();
    const result = await runCutover(input, driver);
    expect(result).toMatchObject({
      status: "released",
      sha,
      environment: "production",
    });
    expect(events.map(([name]) => name)).toEqual([
      "readMainHead",
      "verifyProduction",
      "prepare",
      "readMainHead",
      "close",
      "drain",
      "deploy",
      "privateSmoke",
      "open",
      "publicCheck",
      "record",
    ]);
    expect(events.every(([, candidate]) => candidate === sha)).toBe(true);
    expect(driver.publicCheck.mock.calls[0][1].opened).toMatchObject({
      mode: "open",
      targetSha: sha,
      web: { versionId: "web-version", sourceSha: sha },
      api: { versionId: "api-version", sourceSha: sha },
    });
  });

  it("skips a docs-only commit without touching either Worker or the gate", async () => {
    const { driver, events } = fixture();
    await expect(
      runCutover(
        {
          ...input,
          impact: { web: false, backend: false, migrate: false },
        },
        driver,
      ),
    ).resolves.toEqual({ status: "skipped", reason: "docs_only", sha });
    expect(events).toEqual([]);
  });

  it("takes a recovery point only for breaking SQL, after drain and before migrate", async () => {
    const { driver, events } = fixture();
    await runCutover(
      {
        ...input,
        impact: { web: true, backend: true, migrate: true },
        migration: { kind: "breaking", paths: ["0012.sql"] },
      },
      driver,
    );
    const order = events.map(([name]) => name);
    expect(order.indexOf("close")).toBeLessThan(order.indexOf("drain"));
    expect(order.indexOf("drain")).toBeLessThan(
      order.indexOf("createRecoveryPoint"),
    );
    expect(order.indexOf("createRecoveryPoint")).toBeLessThan(
      order.indexOf("migrate"),
    );
    expect(driver.createRecoveryPoint).toHaveBeenCalledWith(sha, {
      closure: expect.objectContaining({ mode: "maintenance", targetSha: sha }),
    });
  });

  it("does not create a recovery point for nonbreaking SQL or code-only changes", async () => {
    for (const migration of [
      { kind: "none", paths: [] },
      { kind: "nonbreaking", paths: ["0012.sql"] },
    ]) {
      const { driver } = fixture();
      await runCutover(
        {
          ...input,
          impact: {
            web: true,
            backend: true,
            migrate: migration.kind !== "none",
          },
          migration,
        },
        driver,
      );
      expect(driver.createRecoveryPoint).not.toHaveBeenCalled();
    }
  });

  it("leaves maintenance closed and skips SQL when recovery is unverified", async () => {
    for (const recovery of [
      { snapshotId: "", sourceBranchId: "" },
      { snapshotId: "snap-one" },
    ]) {
      const { driver } = fixture({ values: { createRecoveryPoint: recovery } });
      await expect(
        runCutover(
          {
            ...input,
            impact: { web: true, backend: true, migrate: true },
            migration: { kind: "breaking", paths: ["0012.sql"] },
          },
          driver,
        ),
      ).rejects.toThrow();
      expect(driver.migrate).not.toHaveBeenCalled();
      expect(driver.open).not.toHaveBeenCalled();
      expect(driver.reclose).not.toHaveBeenCalled();
    }
  });

  it("leaves maintenance closed and skips SQL when recovery creation fails", async () => {
    const { driver } = fixture({ fail: "createRecoveryPoint" });
    await expect(
      runCutover(
        {
          ...input,
          impact: { web: true, backend: true, migrate: true },
          migration: { kind: "breaking", paths: ["0012.sql"] },
        },
        driver,
      ),
    ).rejects.toThrow();
    expect(driver.migrate).not.toHaveBeenCalled();
    expect(driver.open).not.toHaveBeenCalled();
  });

  it("rejects a superseded queued run before preparing or closing", async () => {
    const { driver } = fixture({ values: { readMainHead: prior } });
    await expect(runCutover(input, driver)).rejects.toThrow(/superseded/iu);
    expect(driver.prepare).not.toHaveBeenCalled();
    expect(driver.close).not.toHaveBeenCalled();
  });

  it("rechecks main after building and refuses closure if a newer commit arrived", async () => {
    const { driver } = fixture();
    driver.readMainHead.mockResolvedValueOnce(sha).mockResolvedValueOnce(prior);
    await expect(runCutover(input, driver)).rejects.toThrow(/superseded/iu);
    expect(driver.prepare).toHaveBeenCalledOnce();
    expect(driver.close).not.toHaveBeenCalled();
  });

  it("never closes when preparation fails, and leaves closed on pre-open failure", async () => {
    for (const failingStep of [
      "prepare",
      "drain",
      "migrate",
      "deploy",
      "privateSmoke",
      "open",
    ]) {
      const { driver, events } = fixture({ fail: failingStep });
      const release =
        failingStep === "migrate"
          ? {
              ...input,
              impact: { web: true, backend: true, migrate: true },
              migration: { kind: "breaking", paths: ["0012.sql"] },
            }
          : input;
      await expect(runCutover(release, driver)).rejects.toThrow();
      if (failingStep === "prepare") {
        expect(events.map(([name]) => name)).not.toContain("close");
      } else {
        expect(events.map(([name]) => name)).toContain("close");
        expect(events.map(([name]) => name)).not.toContain("record");
      }
      if (failingStep === "open") {
        expect(driver.reclose).toHaveBeenCalledOnce();
      } else {
        expect(driver.reclose).not.toHaveBeenCalled();
      }
    }
  });

  it("recloses after a failed public check and never records success", async () => {
    const { driver, events } = fixture({ fail: "publicCheck" });
    await expect(runCutover(input, driver)).rejects.toThrow();
    expect(events.slice(-2).map(([name]) => name)).toEqual([
      "publicCheck",
      "reclose",
    ]);
    expect(driver.record).not.toHaveBeenCalled();
  });

  it("raises an incident if reclose fails after opening", async () => {
    const { driver } = fixture({
      fail: "publicCheck",
    });
    driver.reclose = vi.fn(async () => {
      throw new Error("reclose unavailable");
    });
    await expect(runCutover(input, driver)).rejects.toThrow(/incident/iu);
    expect(driver.record).not.toHaveBeenCalled();
  });

  it("recloses if the opened gate reports Worker versions other than those deployed", async () => {
    const { driver } = fixture({
      values: {
        open: {
          mode: "open",
          targetSha: sha,
          web: { versionId: "wrong-web", sourceSha: sha },
          api: { versionId: "api-version", sourceSha: sha },
        },
      },
    });
    await expect(runCutover(input, driver)).rejects.toThrow(/version/iu);
    expect(driver.reclose).toHaveBeenCalledOnce();
    expect(driver.publicCheck).not.toHaveBeenCalled();
  });

  it("rejects an existing closure for a newer SHA", async () => {
    const { driver } = fixture({
      values: { close: { mode: "maintenance", targetSha: prior } },
    });
    await expect(runCutover(input, driver)).rejects.toThrow(/closed|SHA/iu);
    expect(driver.drain).not.toHaveBeenCalled();
    expect(driver.record).not.toHaveBeenCalled();
  });

  it("rejects production before mutation unless every trusted gate is present", async () => {
    for (const preflight of [
      { releaseEnabled: false },
      { protectedMain: false },
      { baseline: { expectedSha: prior, currentSha: sha } },
      { targetVerified: false },
    ]) {
      const initial = fixture();
      const original = await initial.driver.verifyProduction(sha);
      const { driver, events } = fixture({
        values: { verifyProduction: { ...original, ...preflight } },
      });
      await expect(
        runCutover({ ...input, environment: "production" }, driver),
      ).rejects.toThrow();
      expect(events.map(([name]) => name)).toEqual([
        "readMainHead",
        "verifyProduction",
      ]);
    }
  });

  it("accepts a production cutover with no staging or recovery prerequisite for code-only changes", async () => {
    const { driver, events } = fixture();
    await expect(
      runCutover({ ...input, environment: "production" }, driver),
    ).resolves.toMatchObject({ status: "released", environment: "production" });
    expect(events.map(([name]) => name)).not.toContain("createRecoveryPoint");
    expect(events.map(([name]) => name)).not.toContain("verifyStaging");
  });

  it("rejects an obsolete staging release before touching the gate", async () => {
    const { driver, events } = fixture();
    await expect(
      runCutover({ ...input, environment: "staging" }, driver),
    ).rejects.toThrow(/invalid/iu);
    expect(events).toEqual([]);
  });
});
