import { describe, expect, it, vi } from "vitest";

import {
  recordDeployment,
  selectProductionBaseline,
} from "./deployment-ledger.mjs";

const sha = "a".repeat(40);
const previousSha = "b".repeat(40);
const versions = {
  web: { versionId: "web-1", sourceSha: sha },
  api: { versionId: "api-1", sourceSha: previousSha },
};
const deployment = {
  id: 42,
  sha,
  environment: "production",
  task: "lovechapter-worker-release",
  payload: versions,
};
const status = { id: 99, deployment_id: 42, state: "success" };
const gate = { mode: "open", targetSha: sha, ...versions };

describe("durable production deployment ledger", () => {
  it("uses only a successful exact-SHA deployment matching release_control", () => {
    expect(selectProductionBaseline([deployment], [status], gate)).toEqual({
      sha,
      ...versions,
    });
  });

  it("rejects failed, missing, unrelated, stale, or database-mismatched records", () => {
    for (const [deployments, statuses, gateStatus] of [
      [[deployment], [], gate],
      [[deployment], [{ ...status, state: "failure" }], gate],
      [[deployment], [status, { ...status, id: 100, state: "inactive" }], gate],
      [[{ ...deployment, environment: "staging" }], [status], gate],
      [[{ ...deployment, task: "deploy" }], [status], gate],
      [[{ ...deployment, sha: previousSha }], [status], gate],
      [[deployment], [status], { ...gate, mode: "maintenance" }],
      [
        [deployment],
        [status],
        { ...gate, api: { ...versions.api, versionId: "wrong" } },
      ],
      [[deployment], [status], { ...gate, targetSha: previousSha }],
    ]) {
      expect(
        selectProductionBaseline(deployments, statuses, gateStatus),
      ).toBeNull();
    }
  });

  it("does not fall back to an older success after a newer production attempt", () => {
    const newer = { ...deployment, id: 43, sha: previousSha };
    expect(
      selectProductionBaseline(
        [deployment, newer],
        [status, { id: 100, deployment_id: 43, state: "failure" }],
        gate,
      ),
    ).toBeNull();
  });

  it("records only after reopen and public verification without user data", async () => {
    const githubClient = {
      createDeployment: vi.fn(async () => ({ id: 42 })),
      createDeploymentStatus: vi.fn(async () => ({ id: 99 })),
    };
    const result = {
      environment: "production",
      sha,
      ...versions,
      gateStatus: gate,
      publicCheckPassed: true,
      credential: "never-serialize-this",
      userEmail: "do-not-copy@example.com",
    };
    await recordDeployment(result, githubClient);
    expect(githubClient.createDeployment).toHaveBeenCalledWith({
      ref: sha,
      environment: "production",
      task: "lovechapter-worker-release",
      payload: versions,
      auto_merge: false,
      required_contexts: [],
    });
    expect(githubClient.createDeploymentStatus).toHaveBeenCalledWith(42, {
      state: "success",
      environment: "production",
    });
    expect(
      JSON.stringify(githubClient.createDeployment.mock.calls),
    ).not.toMatch(/never-serialize-this|do-not-copy/);
  });

  it("never writes a success record when reopen or public check has not passed", async () => {
    const githubClient = {
      createDeployment: vi.fn(),
      createDeploymentStatus: vi.fn(),
    };
    for (const result of [
      {
        environment: "production",
        sha,
        ...versions,
        gateStatus: { ...gate, mode: "maintenance" },
        publicCheckPassed: true,
      },
      {
        environment: "production",
        sha,
        ...versions,
        gateStatus: gate,
        publicCheckPassed: false,
      },
      {
        environment: "production",
        sha,
        ...versions,
        gateStatus: { ...gate, api: { versionId: "wrong", sourceSha: sha } },
        publicCheckPassed: true,
      },
    ]) {
      await expect(recordDeployment(result, githubClient)).rejects.toThrow();
    }
    expect(githubClient.createDeployment).not.toHaveBeenCalled();
    expect(githubClient.createDeploymentStatus).not.toHaveBeenCalled();
  });
});
