import {
  AuthService,
  createActionTokenCodec,
  createScryptPasswordHasher,
} from "@lovechapter/auth";
import type { InvocationPostgresRuntime } from "@lovechapter/database";
import { LoveChapterService } from "@lovechapter/domain";

import { createApiIdentityProvider } from "./api-identity";
import { createApiApp, type ApiDependencies } from "./app";
import type { ApiRuntimeConfig } from "./runtime-config";

export function createApiDependencies(
  environment: Record<string, string | undefined>,
  config: ApiRuntimeConfig,
  postgres: Omit<InvocationPostgresRuntime, "readiness"> & {
    readiness(): Promise<void>;
  },
): ApiDependencies {
  const authService = new AuthService({
    repository: postgres.authRepository,
    passwordHasher: createScryptPasswordHasher(),
    actionTokenCodec: createActionTokenCodec({
      activeVersion: config.authTokenActiveKeyVersion,
      keys: config.authTokenHmacKeys,
    }),
    clock: { now: () => new Date() },
    rateLimitSecret: config.rateLimitHmacKey,
  });
  const identity = createApiIdentityProvider(
    { ...environment, AUTH_MODE: config.authMode },
    { authService, nodeEnvironment: config.nodeEnvironment },
  );
  return {
    authService,
    nodeEnvironment: config.nodeEnvironment,
    publicWebOrigin: config.publicWebOrigin,
    proxyCredential: config.proxyCredential,
    fingerprintKey: config.rateLimitHmacKey,
    readiness: async () => {
      await postgres.readiness();
      await postgres.releaseGateStore.readMode();
    },
    releaseMode: () => postgres.releaseGateStore.readMode(),
    run: (request, operation) =>
      operation(
        new LoveChapterService(
          identity,
          postgres.loveChapterRepository,
          config.publicWebOrigin,
          request,
          postgres.guestImportRepository,
          postgres.envelopeRepository,
          postgres.planningRepository,
          postgres.operationsRepository,
        ),
      ),
  };
}

export function createApiHandler(
  environment: Record<string, string | undefined>,
  config: ApiRuntimeConfig,
  postgres: Omit<InvocationPostgresRuntime, "readiness"> & {
    readiness(): Promise<void>;
  },
) {
  return createApiApp(
    createApiDependencies(environment, config, postgres),
  ).compile();
}
