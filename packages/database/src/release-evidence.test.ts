import { describe, expect, it } from "vitest";

import { validateReleaseEvidence } from "./release-evidence";

const sha = "a".repeat(40);
const previousSha = "b".repeat(40);
const prior = {
  web: { versionId: "web-old", sourceSha: previousSha },
  api: { versionId: "api-old", sourceSha: previousSha },
};
const context = {
  environment: "production" as const,
  sha,
  closedAt: "2026-09-26T06:00:00.000Z",
  previousVersions: prior,
  stagingSha: sha,
};

function evidence(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    environment: "production",
    commitSha: sha,
    stagingSha: sha,
    web: { versionId: "web-new", sourceSha: sha, changed: true },
    api: { ...prior.api, changed: false },
    migration: "not_required",
    privateSmokePassed: true,
    inboxDelivery: "waived",
    acceptedAt: "2026-09-26T07:00:00.000Z",
    password: "never-serialize-this",
    ...overrides,
  });
}

describe("exact-SHA release evidence", () => {
  it("attests web-only deployment while preserving the previous API version", () => {
    const accepted = validateReleaseEvidence(evidence(), context);
    expect(accepted.web).toEqual({
      versionId: "web-new",
      sourceSha: sha,
      changed: true,
    });
    expect(accepted.api).toEqual({ ...prior.api, changed: false });
    expect(JSON.stringify(accepted)).not.toContain("never-serialize-this");
  });

  it("requires both changed Worker versions to originate from the candidate SHA", () => {
    const both = {
      api: { versionId: "api-new", sourceSha: sha, changed: true },
    };
    expect(validateReleaseEvidence(evidence(both), context).api).toEqual(
      both.api,
    );
    for (const invalid of [
      { api: { versionId: "api-new", sourceSha: previousSha, changed: true } },
      { api: { versionId: "api-old", sourceSha: sha, changed: true } },
      { api: { versionId: "api-other", sourceSha: sha, changed: false } },
    ]) {
      expect(() =>
        validateReleaseEvidence(evidence(invalid), context),
      ).toThrow();
    }
  });

  it("rejects stale, wrong-environment, wrong-SHA, and unaccepted evidence", () => {
    for (const invalid of [
      { acceptedAt: context.closedAt },
      { acceptedAt: "2026-09-26T05:59:59.000Z" },
      { acceptedAt: "2026" },
      { commitSha: previousSha },
      { stagingSha: previousSha },
      { environment: "staging" },
      { privateSmokePassed: false },
      { inboxDelivery: "received" },
      { migration: "unknown" },
    ]) {
      expect(() =>
        validateReleaseEvidence(evidence(invalid), context),
      ).toThrow();
    }
  });

  it("requires both new versions for a first deployment without a baseline", () => {
    const bootstrap = { ...context, previousVersions: null };
    expect(() => validateReleaseEvidence(evidence(), bootstrap)).toThrow();
    expect(() =>
      validateReleaseEvidence(
        evidence({
          api: { versionId: "api-new", sourceSha: sha, changed: true },
        }),
        bootstrap,
      ),
    ).not.toThrow();
  });
});
