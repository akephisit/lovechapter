import { describe, expect, it, vi } from "vitest";

import { resolveReleasePlan } from "./release-plan.mjs";

const baseSha = "a".repeat(40);
const sha = "b".repeat(40);

function gitFor(diff, { head = sha, ancestor = true } = {}) {
  return vi.fn((args) => {
    if (args[0] === "rev-parse") return `${head}\n`;
    if (args[0] === "merge-base") {
      if (!ancestor) throw new Error("unknown git command output");
      return "";
    }
    if (args[0] === "diff") return diff;
    throw new Error("unexpected command");
  });
}

describe("release plan from last accepted baseline", () => {
  it("classifies changed files across the baseline-to-candidate range", async () => {
    const runGit = gitFor("M\0apps/web/src/app/page.tsx\0");
    const plan = await resolveReleasePlan(
      { baselineSha: baseSha, sha },
      { runGit },
    );
    expect(plan).toEqual({
      baselineSha: baseSha,
      sha,
      impact: { web: true, backend: false, migrate: false },
      migration: { kind: "none", paths: [] },
    });
    expect(runGit).toHaveBeenCalledWith([
      "diff",
      "--no-renames",
      "--name-status",
      "-z",
      baseSha,
      sha,
    ]);
  });

  it("never guesses the range when checkout SHA differs or baseline is not an ancestor", async () => {
    for (const runGit of [
      gitFor("", { head: "c".repeat(40) }),
      gitFor("", { ancestor: false }),
    ]) {
      await expect(
        resolveReleasePlan({ baselineSha: baseSha, sha }, { runGit }),
      ).rejects.toThrow();
      expect(runGit.mock.calls.some(([args]) => args[0] === "diff")).toBe(
        false,
      );
    }
  });

  it("requires migration review and blocks destructive migration before release", async () => {
    const runGit = gitFor("A\0packages/database/drizzle/0012_change.sql\0");
    const review = `## Classification\nbreaking: yes\ndata_deletion: yes\n## Data transformation\nTransform rows\n## Locking and query effects\nLock\n## Validation\nCheck\n## Recovery\nRestore`;
    await expect(
      resolveReleasePlan(
        { baselineSha: baseSha, sha },
        {
          runGit,
          readReview: vi.fn(async () => review),
        },
      ),
    ).rejects.toThrow(/blocked/iu);
  });

  it("returns a no-deployment plan for documentation-only changes", async () => {
    const plan = await resolveReleasePlan(
      { baselineSha: baseSha, sha },
      {
        runGit: gitFor("M\0docs/DEPLOYMENT.md\0"),
      },
    );
    expect(plan.impact).toEqual({ web: false, backend: false, migrate: false });
    expect(plan.migration.kind).toBe("none");
  });
});
