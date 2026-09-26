import { describe, expect, it } from "vitest";

import { buildReleaseEvidence } from "./release-evidence-builder.mjs";

const sha = "a".repeat(40);
const oldSha = "b".repeat(40);
const previous = {
  web: { versionId: "web-old", sourceSha: oldSha },
  api: { versionId: "api-old", sourceSha: oldSha },
};
const deployed = {
  web: { versionId: "web-new", sourceSha: sha },
  api: { versionId: "api-new", sourceSha: sha },
};
const closure = { changedAt: "2026-09-26T06:00:00.000Z" };
const smoke = { passed: true, acceptedAt: "2026-09-26T06:01:00.000Z" };

function input(overrides = {}) {
  return {
    environment: "staging",
    sha,
    impact: { web: true, backend: false, migrate: false },
    previous,
    deployed: { web: deployed.web, api: previous.api },
    closure,
    smoke,
    migrationOutcome: "not_required",
    ...overrides,
  };
}

describe("release reopen evidence", () => {
  it("keeps the unchanged API version and original source SHA on a web-only release", () => {
    expect(buildReleaseEvidence(input())).toEqual({
      environment: "staging",
      commitSha: sha,
      stagingSha: null,
      web: { ...deployed.web, changed: true },
      api: { ...previous.api, changed: false },
      migration: "not_required",
      privateSmokePassed: true,
      inboxDelivery: "waived",
      acceptedAt: smoke.acceptedAt,
    });
  });

  it("requires both new Worker versions for a both-component release", () => {
    const evidence = buildReleaseEvidence(
      input({
        impact: { web: true, backend: true, migrate: true },
        deployed,
        migrationOutcome: "applied_and_validated",
      }),
    );
    expect(evidence.web).toEqual({ ...deployed.web, changed: true });
    expect(evidence.api).toEqual({ ...deployed.api, changed: true });
  });

  it("binds production evidence to the exact accepted staging SHA", () => {
    const evidence = buildReleaseEvidence(
      input({
        environment: "production",
        stagingSha: sha,
      }),
    );
    expect(evidence.stagingSha).toBe(sha);
    expect(() =>
      buildReleaseEvidence(
        input({ environment: "production", stagingSha: oldSha }),
      ),
    ).toThrow();
  });

  it("rejects false smoke, stale closure, and unchanged-component drift", () => {
    for (const candidate of [
      input({ smoke: { passed: false, acceptedAt: smoke.acceptedAt } }),
      input({ smoke: { passed: true, acceptedAt: closure.changedAt } }),
      input({ deployed: { web: deployed.web, api: deployed.api } }),
    ]) {
      expect(() => buildReleaseEvidence(candidate)).toThrow();
    }
  });

  it("serializes only version identifiers and source SHAs, never extra provider fields", () => {
    const evidence = buildReleaseEvidence(
      input({
        deployed: {
          web: { ...deployed.web, privateToken: "must-not-be-evidence" },
          api: previous.api,
        },
      }),
    );
    expect(evidence.web).toEqual({ ...deployed.web, changed: true });
    expect(JSON.stringify(evidence)).not.toContain("must-not-be-evidence");
  });
});
