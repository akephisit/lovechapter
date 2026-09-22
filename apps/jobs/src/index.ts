import { createActionTokenCodec } from "@lovechapter/auth";
import { createPostgresRuntime } from "@lovechapter/database";

import { runJobLoop } from "./processor";
import { createResendEmailSender } from "./resend-email-sender";
import { parseJobsRuntimeConfig } from "./runtime-config";

const APPROVED_BUN_VERSION = "1.4.2";

export async function runEmailWorker(): Promise<void> {
  if (Bun.version !== APPROVED_BUN_VERSION) {
    throw new Error(
      `Bun ${APPROVED_BUN_VERSION} is required; received ${Bun.version}`,
    );
  }
  const config = parseJobsRuntimeConfig(
    Bun.env as Record<string, string | undefined>,
  );
  const postgres = createPostgresRuntime(config);
  const controller = new AbortController();
  const shutdown = () => controller.abort();
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  try {
    await runJobLoop({
      store: postgres.emailJobStore,
      sender: createResendEmailSender({ apiKey: config.resendApiKey }),
      tokenCodec: createActionTokenCodec({
        activeVersion: config.authTokenActiveKeyVersion,
        keys: config.authTokenHmacKeys,
      }),
      publicWebOrigin: config.publicWebOrigin,
      fromEmail: config.resendFromEmail,
      signal: controller.signal,
      log: (event, fields) =>
        console.info(JSON.stringify({ event, ...fields })),
    });
  } finally {
    process.off("SIGTERM", shutdown);
    process.off("SIGINT", shutdown);
    await postgres.close();
  }
}

if (import.meta.main) {
  try {
    await runEmailWorker();
  } catch {
    console.error("auth_email_worker_failed");
    process.exitCode = 1;
  }
}
