import { describe, expect, it, vi } from "vitest";

import {
  createPostgresJobMarkerStore,
  runStagingJobsAcceptance,
} from "./staging-jobs.mjs";

const sha = "a".repeat(40);

function harness({ emailAfter = 1, cleanupAfter = 2, errorAt = -1 } = {}) {
  let now = 0;
  let polls = 0;
  let cleanupReads = 0;
  const store = {
    createEmailMarker: vi.fn(async () => ({ id: "email-job" })),
    createCleanupMarker: vi.fn(async () => ({ id: "cleanup-row" })),
    emailStatus: vi.fn(async () => {
      polls += 1;
      return {
        sentAt: polls >= emailAfter ? "2026-09-26T00:00:00Z" : null,
        lastErrorCode: polls === errorAt ? "provider_rate_limited" : null,
        attemptCount: polls === errorAt || polls >= emailAfter ? 1 : 0,
      };
    }),
    cleanupMarkerExists: vi.fn(async () => {
      cleanupReads += 1;
      return cleanupReads < cleanupAfter;
    }),
    cleanup: vi.fn(async () => undefined),
  };
  const clock = {
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  };
  return { store, clock };
}

const input = {
  sha,
  deadlines: { emailMs: 60_000, cleanupMs: 120_000, pollMs: 10_000 },
};

describe("staging scheduled-job acceptance", () => {
  it("creates bounded markers and deletes only its exact cleanup key", async () => {
    const queries = [];
    let jobRead = 0;
    const client = {
      query: vi.fn(async (sql, params = []) => {
        queries.push({ sql, params });
        if (sql.includes("select j.id from auth_email_jobs")) {
          jobRead += 1;
          return {
            rows: (jobRead === 1 ? ["old"] : ["new", "old"]).map((id) => ({
              id,
            })),
          };
        }
        if (sql.includes("insert into auth_rate_limits")) {
          return {
            rows: [
              {
                scope: "release-smoke",
                key_hash: params[0],
                bucket_started_at: new Date("2026-09-26T00:00:00Z"),
              },
            ],
          };
        }
        if (sql.includes("select j.sent_at")) {
          return {
            rows: [
              {
                sent_at: new Date("2026-09-26T00:01:00Z"),
                last_error_code: null,
                attempt_count: 1,
              },
            ],
          };
        }
        if (sql.includes("select 1 from auth_rate_limits")) {
          return { rows: [] };
        }
        return { rows: [], rowCount: 1 };
      }),
    };
    const fetcher = vi.fn(
      async () => new globalThis.Response(null, { status: 202 }),
    );
    const store = createPostgresJobMarkerStore({
      client,
      webOrigin: "https://web-staging.example.workers.dev",
      testEmail: "verified@example.test",
      fetcher,
    });
    expect(await store.createEmailMarker(sha)).toEqual({ id: "new" });
    const marker = await store.createCleanupMarker(sha);
    expect(marker.id).toMatch(/^[0-9a-f]{64}$/u);
    expect(await store.emailStatus("new")).toMatchObject({ attemptCount: 1 });
    expect(await store.cleanupMarkerExists(marker.id)).toBe(false);
    await store.cleanup();
    const deletion = queries.find(({ sql }) =>
      sql.includes("delete from auth_rate_limits"),
    );
    expect(deletion.params).toEqual([
      "release-smoke",
      marker.id,
      new Date("2026-09-26T00:00:00Z"),
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://web-staging.example.workers.dev/api/v1/auth/forgot-password",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("requires actual email-send and cleanup state changes before deadlines", async () => {
    const context = harness();
    await expect(runStagingJobsAcceptance(input, context)).resolves.toEqual({
      commitSha: sha,
      checks: ["scheduled_email_provider", "scheduled_cleanup"],
      inboxDelivery: "waived",
      providerRetry: "isolated_postgres_required",
    });
    expect(context.store.createEmailMarker).toHaveBeenCalledWith(sha);
    expect(context.store.createCleanupMarker).toHaveBeenCalledWith(sha);
    expect(context.store.cleanup).toHaveBeenCalledOnce();
  });

  it("rejects missed email or cleanup tick and always removes its marker", async () => {
    for (const options of [{ emailAfter: 100 }, { cleanupAfter: 100 }]) {
      const context = harness(options);
      await expect(runStagingJobsAcceptance(input, context)).rejects.toThrow();
      expect(context.store.cleanup).toHaveBeenCalledOnce();
    }
  });

  it("rejects a provider error rather than counting a queued retry as a pass", async () => {
    const context = harness({ emailAfter: 10, errorAt: 1 });
    await expect(runStagingJobsAcceptance(input, context)).rejects.toThrow(
      /provider/u,
    );
    expect(context.store.cleanup).toHaveBeenCalledOnce();
  });

  it("rejects a missing marker or failed cleanup", async () => {
    const missing = harness();
    missing.store.emailStatus = vi.fn(async () => null);
    await expect(runStagingJobsAcceptance(input, missing)).rejects.toThrow();
    const broken = harness();
    broken.store.cleanup = vi.fn(async () => {
      throw new Error("cleanup failed");
    });
    await expect(runStagingJobsAcceptance(input, broken)).rejects.toThrow(
      /cleanup failed/u,
    );
  });
});
