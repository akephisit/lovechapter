import { AsyncLocalStorage } from "node:async_hooks";

import { createActionTokenCodec } from "@lovechapter/auth";
import {
  withPostgresRuntime,
  withPostgresResponse,
  type PostgresClientFactory,
} from "@lovechapter/database";
import { createResendEmailSender } from "@lovechapter/jobs/resend-email-sender";
import { parseJobsRuntimeConfig } from "@lovechapter/jobs/runtime-config";

import { createApiDependencies } from "./api-handler";
import { createApiApp, type ApiDependencies } from "./app";
import { parseApiRuntimeConfig } from "./runtime-config";
import { withApiAdmission } from "./release-admission";
import { runScheduledBatch } from "./worker-jobs";

const invocation = new AsyncLocalStorage<ApiDependencies>();

function currentDependencies(): ApiDependencies {
  const dependencies = invocation.getStore();
  if (!dependencies) throw new Error("Worker request context is missing");
  return dependencies;
}

// Compile once during isolate startup; each request still receives its own dependencies.
const app = createApiApp({
  get authService() {
    return currentDependencies().authService;
  },
  get nodeEnvironment() {
    return currentDependencies().nodeEnvironment;
  },
  get publicWebOrigin() {
    return currentDependencies().publicWebOrigin;
  },
  get proxyCredential() {
    return currentDependencies().proxyCredential;
  },
  get fingerprintKey() {
    return currentDependencies().fingerprintKey;
  },
  readiness: () => currentDependencies().readiness(),
  releaseMode: () => currentDependencies().releaseMode(),
  run: (request, operation) => currentDependencies().run(request, operation),
} satisfies ApiDependencies).compile();

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
          invocation.run(
            createApiDependencies(variables, config, postgres),
            () =>
              withApiAdmission(
                request,
                postgres.releaseGateStore,
                {
                  proxyCredential: config.proxyCredential,
                  fingerprintKey: config.rateLimitHmacKey,
                },
                async () => app.fetch(request),
              ),
          ),
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
