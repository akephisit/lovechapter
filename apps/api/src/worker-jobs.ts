import type { EmailProcessorOptions } from "@lovechapter/jobs/processor";
import {
  CLEANUP_BATCH_SIZE,
  processEmailBatch,
} from "@lovechapter/jobs/processor";

export async function runScheduledBatch(
  cron: string,
  options: EmailProcessorOptions,
): Promise<void> {
  if (cron === "* * * * *") {
    await processEmailBatch(options);
    return;
  }
  if (cron === "*/15 * * * *") {
    const now = (options.clock ?? { now: () => new Date() }).now();
    await options.store.cleanupExpired({ now, limit: CLEANUP_BATCH_SIZE });
    await options.guestImportCleanup?.cleanupExpiredGuestImports({
      now: now.toISOString(),
      limit: CLEANUP_BATCH_SIZE,
    });
    return;
  }
  throw new Error("Unsupported cron trigger");
}
