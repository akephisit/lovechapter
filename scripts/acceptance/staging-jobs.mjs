import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { URL } from "node:url";

const shaPattern = /^[0-9a-f]{40}$/u;
export const DEFAULT_JOB_DEADLINES = Object.freeze({
  emailMs: 150_000,
  cleanupMs: 17 * 60_000,
  pollMs: 5_000,
});

/** Observe the real scheduled Worker ticks; this function never invokes cron itself. */
export async function runStagingJobsAcceptance(
  { sha, deadlines },
  {
    store,
    clock = {
      now: () => Date.now(),
      sleep: (ms) => delay(ms),
    },
  },
) {
  const { emailMs, cleanupMs, pollMs } = deadlines ?? {};
  if (
    !shaPattern.test(sha ?? "") ||
    !store ||
    !Number.isInteger(emailMs) ||
    !Number.isInteger(cleanupMs) ||
    !Number.isInteger(pollMs) ||
    emailMs < 60_000 ||
    cleanupMs < emailMs ||
    pollMs <= 0 ||
    pollMs > emailMs
  ) {
    throw new Error("Scheduled-job acceptance inputs are invalid");
  }
  const started = clock.now();
  let emailMarker;
  let cleanupMarker;
  let emailPassed = false;
  let cleanupPassed = false;
  try {
    emailMarker = await store.createEmailMarker(sha);
    cleanupMarker = await store.createCleanupMarker(sha);
    if (!emailMarker?.id || !cleanupMarker?.id) {
      throw new Error("Scheduled-job marker was not created");
    }
    while (!emailPassed || !cleanupPassed) {
      const elapsed = clock.now() - started;
      if (!emailPassed) {
        const status = await store.emailStatus(emailMarker.id);
        if (!status) throw new Error("Scheduled email marker disappeared");
        if (status.lastErrorCode || status.attemptCount > 1) {
          throw new Error("Scheduled email provider rejected the marker");
        }
        emailPassed = Boolean(status.sentAt) && status.attemptCount === 1;
      }
      if (!cleanupPassed) {
        cleanupPassed = !(await store.cleanupMarkerExists(cleanupMarker.id));
      }
      if (!emailPassed && elapsed >= emailMs) {
        throw new Error("Scheduled email deadline was missed");
      }
      if (!cleanupPassed && elapsed >= cleanupMs) {
        throw new Error("Scheduled cleanup deadline was missed");
      }
      if (!emailPassed || !cleanupPassed) {
        await clock.sleep(Math.min(pollMs, cleanupMs - elapsed));
      }
    }
  } finally {
    await store.cleanup();
  }
  return {
    commitSha: sha,
    checks: ["scheduled_email_provider", "scheduled_cleanup"],
    inboxDelivery: "waived",
    providerRetry: "isolated_postgres_required",
  };
}

/** The release coordinator supplies a verified staging-only direct pg client. */
export function createPostgresJobMarkerStore({
  client,
  webOrigin,
  testEmail,
  fetcher = globalThis.fetch,
}) {
  let origin;
  try {
    const url = new URL(webOrigin);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".workers.dev") ||
      url.pathname !== "/"
    ) {
      throw new Error("invalid origin");
    }
    origin = url.origin;
  } catch {
    throw new Error("Staging job probe requires a workers.dev HTTPS origin");
  }
  if (!client?.query || !testEmail) {
    throw new Error(
      "Staging job probe requires a database client and test email",
    );
  }
  let cleanupMarker = null;
  async function jobIds() {
    const result = await client.query(
      `select j.id from auth_email_jobs j
       join auth_accounts a on a.id = j.account_id
       where j.kind = 'reset_password' and a.email = $1
       order by j.created_at desc, j.id desc limit 101`,
      [testEmail],
    );
    if (result.rows.length > 100)
      throw new Error("Email marker history exceeds bound");
    return result.rows.map((row) => row.id);
  }
  return {
    async createEmailMarker(sha) {
      if (!shaPattern.test(sha)) throw new Error("Invalid release SHA");
      const previous = new Set(await jobIds());
      const response = await fetcher(`${origin}/api/v1/auth/forgot-password`, {
        method: "POST",
        headers: { Origin: origin, "content-type": "application/json" },
        body: JSON.stringify({ email: testEmail }),
        cache: "no-store",
        redirect: "manual",
        signal: globalThis.AbortSignal.timeout(20_000),
      });
      if (response.status !== 202) {
        throw new Error("Staging reset request did not enter the outbox");
      }
      const created = (await jobIds()).filter((id) => !previous.has(id));
      if (created.length !== 1) {
        throw new Error("Staging reset marker is not unique");
      }
      return { id: created[0] };
    },
    async createCleanupMarker(sha) {
      if (!shaPattern.test(sha)) throw new Error("Invalid release SHA");
      const keyHash = createHash("sha256")
        .update(`release-smoke:${sha}:${randomUUID()}`)
        .digest("hex");
      const result = await client.query(
        `insert into auth_rate_limits(scope,key_hash,bucket_started_at,count,expires_at)
         values('release-smoke',$1,date_trunc('minute',now()),1,now()-interval '1 minute')
         returning scope,key_hash,bucket_started_at`,
        [keyHash],
      );
      if (result.rows.length !== 1)
        throw new Error("Cleanup marker was not inserted");
      cleanupMarker = result.rows[0];
      return { id: keyHash };
    },
    async emailStatus(id) {
      const result = await client.query(
        `select j.sent_at,j.last_error_code,j.attempt_count
         from auth_email_jobs j join auth_accounts a on a.id = j.account_id
         where j.id = $1 and j.kind = 'reset_password' and a.email = $2 limit 1`,
        [id, testEmail],
      );
      const row = result.rows[0];
      return row
        ? {
            sentAt: row.sent_at,
            lastErrorCode: row.last_error_code,
            attemptCount: row.attempt_count,
          }
        : null;
    },
    async cleanupMarkerExists(id) {
      if (!cleanupMarker || id !== cleanupMarker.key_hash) {
        throw new Error("Cleanup marker is outside this run's scope");
      }
      const result = await client.query(
        `select 1 from auth_rate_limits
         where scope = $1 and key_hash = $2 and bucket_started_at = $3 limit 1`,
        [
          cleanupMarker.scope,
          cleanupMarker.key_hash,
          cleanupMarker.bucket_started_at,
        ],
      );
      return result.rows.length === 1;
    },
    async cleanup() {
      if (!cleanupMarker) return;
      await client.query(
        `delete from auth_rate_limits
         where scope = $1 and key_hash = $2 and bucket_started_at = $3`,
        [
          cleanupMarker.scope,
          cleanupMarker.key_hash,
          cleanupMarker.bucket_started_at,
        ],
      );
      cleanupMarker = null;
    },
  };
}
