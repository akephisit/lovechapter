import type { EmailProcessorOptions } from "@lovechapter/jobs/processor";
import type { ReleaseGateStore } from "@lovechapter/database";
import {
  CLEANUP_BATCH_SIZE,
  processEmailBatch,
  runAdmittedBatch,
} from "@lovechapter/jobs/processor";

export async function runScheduledBatch(
  cron: string,
  options: EmailProcessorOptions,
  releaseGate: ReleaseGateStore,
): Promise<void> {
  if (cron === "* * * * *") {
    await runAdmittedBatch(
      releaseGate,
      "email",
      async () => {
        await processEmailBatch(options);
      },
      options.log,
    );
    return;
  }
  if (cron === "*/15 * * * *") {
    await runAdmittedBatch(
      releaseGate,
      "cleanup",
      async () => {
        const now = (options.clock ?? { now: () => new Date() }).now();
        await options.store.cleanupExpired({ now, limit: CLEANUP_BATCH_SIZE });
        await options.guestImportCleanup?.cleanupExpiredGuestImports({
          now: now.toISOString(),
          limit: CLEANUP_BATCH_SIZE,
        });
      },
      options.log,
    );
    return;
  }
  throw new Error("Unsupported cron trigger");
}
