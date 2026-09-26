import { REQUIRED_STAGING_CHECKS } from "./release-orchestrator.mjs";

const shaPattern = /^[0-9a-f]{40}$/u;
const httpChecks = Object.freeze([
  "verification_outbox",
  "reset_outbox",
  "verified_session",
  "tenant_isolation",
  "guest_rsvp",
  "csv_round_trip",
  "session_revoked",
  "scoped_cleanup",
]);
const jobChecks = Object.freeze([
  "scheduled_email_provider",
  "scheduled_cleanup",
]);
const planNames = Object.freeze([
  "wedding-list",
  "guest-list",
  "invitation-lookup",
  "auth-email-lookup",
  "session-lookup",
  "due-email-jobs",
  "rate-limit-cleanup",
]);

function exactSet(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    new Set(actual).size === expected.length &&
    expected.every((item) => actual.includes(item))
  );
}

/** Project only checks proven by the current SHA's real staging probes. */
export async function runStagingAcceptance(
  sha,
  { http, jobs, queryPlans, retryEvidence } = {},
) {
  if (
    !shaPattern.test(sha ?? "") ||
    typeof http !== "function" ||
    typeof jobs !== "function" ||
    typeof queryPlans !== "function" ||
    retryEvidence?.commitSha !== sha ||
    retryEvidence.check !== "postgres_retry" ||
    retryEvidence.passed !== true ||
    retryEvidence.source !== "same_sha_postgres_job"
  ) {
    throw new Error("Staging acceptance inputs are incomplete");
  }
  try {
    const httpResult = await http(sha);
    if (
      httpResult?.commitSha !== sha ||
      httpResult.inboxDelivery !== "waived" ||
      !exactSet(httpResult.checks, httpChecks)
    ) {
      throw new Error("Staging HTTP acceptance is incomplete");
    }
    const jobsResult = await jobs(sha);
    if (
      jobsResult?.commitSha !== sha ||
      jobsResult.inboxDelivery !== "waived" ||
      jobsResult.providerRetry !== "isolated_postgres_required" ||
      !exactSet(jobsResult.checks, jobChecks)
    ) {
      throw new Error("Staging scheduled-job acceptance is incomplete");
    }
    const plansResult = await queryPlans(sha);
    if (
      plansResult?.commitment !== "disposable_branch_only" ||
      !exactSet(
        plansResult.plans?.map((plan) => plan?.name),
        planNames,
      )
    ) {
      throw new Error("Staging query-plan acceptance is incomplete");
    }
    const checks = [
      ...httpChecks,
      ...jobChecks,
      "query_plans",
      "postgres_retry",
    ];
    if (!exactSet(checks, REQUIRED_STAGING_CHECKS)) {
      throw new Error("Staging acceptance contract differs from release gate");
    }
    return { commitSha: sha, checks, inboxDelivery: "waived" };
  } catch {
    throw new Error("Staging acceptance failed");
  }
}
