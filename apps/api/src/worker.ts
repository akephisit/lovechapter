import { createActionTokenCodec } from "@lovechapter/auth";
import {
  withPostgresRuntime,
  withPostgresResponse,
  type PostgresClientFactory,
} from "@lovechapter/database";
import { createResendEmailSender } from "@lovechapter/jobs/resend-email-sender";
import { parseJobsRuntimeConfig } from "@lovechapter/jobs/runtime-config";

import { createApiHandler } from "./api-handler";
import { parseApiRuntimeConfig } from "./runtime-config";
import { runScheduledBatch } from "./worker-jobs";

export type WorkerEnvironment = {
  HYPERDRIVE?: { connectionString: string } | undefined;
  [name: string]: string | undefined | { connectionString: string };
};

function workerVariables(
  environment: WorkerEnvironment,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function workerConnectionString(environment: WorkerEnvironment): string {
  const connectionString = environment.HYPERDRIVE?.connectionString?.trim();
  if (!connectionString) throw new Error("HYPERDRIVE binding is required");
  return connectionString;
}

export function createWorkerHandlers(createClient?: PostgresClientFactory) {
  return {
    async fetch(
      request: Request,
      environment: WorkerEnvironment,
    ): Promise<Response> {
      const connectionString = workerConnectionString(environment);
      const variables = workerVariables(environment);
      const config = parseApiRuntimeConfig({
        ...variables,
        DATABASE_URL: connectionString,
      });
      if (config.authMode === "local") {
        parseJobsRuntimeConfig({
          ...variables,
          DATABASE_URL: connectionString,
        });
      }
      return withPostgresResponse(
        connectionString,
        async (postgres) =>
          createApiHandler(variables, config, postgres).fetch(request),
        createClient,
      );
    },
    async scheduled(
      event: { cron: string },
      environment: WorkerEnvironment,
    ): Promise<void> {
      if (event.cron !== "* * * * *" && event.cron !== "*/15 * * * *") {
        throw new Error("Unsupported cron trigger");
      }
      const connectionString = workerConnectionString(environment);
      const variables = workerVariables(environment);
      const config = parseJobsRuntimeConfig({
        ...variables,
        DATABASE_URL: connectionString,
      });
      await withPostgresRuntime(
        connectionString,
        async (postgres) =>
          runScheduledBatch(event.cron, {
            store: postgres.emailJobStore,
            guestImportCleanup: postgres.guestImportRepository,
            sender: createResendEmailSender({ apiKey: config.resendApiKey }),
            tokenCodec: createActionTokenCodec({
              activeVersion: config.authTokenActiveKeyVersion,
              keys: config.authTokenHmacKeys,
            }),
            publicWebOrigin: config.publicWebOrigin,
            fromEmail: config.resendFromEmail,
          }),
        createClient,
      );
    },
  };
}

export default createWorkerHandlers();
