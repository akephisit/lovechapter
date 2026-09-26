import { describe, expect, it, vi } from "vitest";

import { runStagingAcceptance } from "./staging-acceptance.mjs";

const sha = "a".repeat(40);
const httpChecks = [
  "verification_outbox",
  "reset_outbox",
  "verified_session",
  "tenant_isolation",
  "guest_rsvp",
  "csv_round_trip",
  "session_revoked",
  "scoped_cleanup",
];
const jobsChecks = ["scheduled_email_provider", "scheduled_cleanup"];
const planNames = [
  "wedding-list",
  "guest-list",
  "invitation-lookup",
  "auth-email-lookup",
  "session-lookup",
  "due-email-jobs",
  "rate-limit-cleanup",
];

function fixture() {
  const events = [];
  const http = vi.fn(async () => {
    events.push("http");
    return { commitSha: sha, checks: httpChecks, inboxDelivery: "waived" };
  });
  const jobs = vi.fn(async () => {
    events.push("jobs");
    return {
      commitSha: sha,
      checks: jobsChecks,
      inboxDelivery: "waived",
      providerRetry: "isolated_postgres_required",
    };
  });
  const queryPlans = vi.fn(async () => {
    events.push("plans");
    return {
      commitment: "disposable_branch_only",
      plans: planNames.map((name) => ({ name })),
    };
  });
  const retryEvidence = {
    commitSha: sha,
    check: "postgres_retry",
    passed: true,
    source: "same_sha_postgres_job",
  };
  return { events, http, jobs, queryPlans, retryEvidence };
}

describe("exact-SHA staging acceptance", () => {
  it("requires the live HTTP, cron, disposable plans, and same-SHA retry evidence", async () => {
    const context = fixture();
    const report = await runStagingAcceptance(sha, context);
    expect(context.events).toEqual(["http", "jobs", "plans"]);
    expect(report).toEqual({
      commitSha: sha,
      checks: [...httpChecks, ...jobsChecks, "query_plans", "postgres_retry"],
      inboxDelivery: "waived",
    });
    expect(JSON.stringify(report)).not.toMatch(
      /private-password|test@example\.test/u,
    );
  });

  it("rejects missing, wrong-SHA, or fabricated HTTP checks before cron", async () => {
    for (const response of [
      { commitSha: sha, checks: httpChecks.slice(1), inboxDelivery: "waived" },
      {
        commitSha: "b".repeat(40),
        checks: httpChecks,
        inboxDelivery: "waived",
      },
      { commitSha: sha, checks: httpChecks, inboxDelivery: "passed" },
      {
        commitSha: sha,
        checks: [...httpChecks, "invented_check"],
        inboxDelivery: "waived",
      },
    ]) {
      const context = fixture();
      context.http.mockResolvedValueOnce(response);
      await expect(runStagingAcceptance(sha, context)).rejects.toThrow();
      expect(context.jobs).not.toHaveBeenCalled();
    }
  });

  it("rejects missed cron, absent query plan, or missing retry evidence", async () => {
    for (const change of [
      {
        jobs: {
          commitSha: sha,
          checks: jobsChecks.slice(1),
          inboxDelivery: "waived",
          providerRetry: "isolated_postgres_required",
        },
      },
      {
        queryPlans: {
          commitment: "disposable_branch_only",
          plans: planNames.slice(1).map((name) => ({ name })),
        },
      },
      {
        retryEvidence: {
          commitSha: sha,
          check: "postgres_retry",
          passed: false,
          source: "same_sha_postgres_job",
        },
      },
      {
        retryEvidence: {
          commitSha: "b".repeat(40),
          check: "postgres_retry",
          passed: true,
          source: "same_sha_postgres_job",
        },
      },
    ]) {
      const context = fixture();
      if (change.jobs) context.jobs.mockResolvedValueOnce(change.jobs);
      if (change.queryPlans)
        context.queryPlans.mockResolvedValueOnce(change.queryPlans);
      if (change.retryEvidence) context.retryEvidence = change.retryEvidence;
      await expect(runStagingAcceptance(sha, context)).rejects.toThrow();
    }
  });

  it("does not propagate provider diagnostics containing credentials", async () => {
    const context = fixture();
    context.http.mockRejectedValueOnce(
      new Error("private-password provider body"),
    );
    await expect(runStagingAcceptance(sha, context)).rejects.toThrow(
      "Staging acceptance failed",
    );
  });
});
