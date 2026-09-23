import {
  AuthService,
  createActionTokenCodec,
  createScryptPasswordHasher,
} from "@lovechapter/auth";
import { createPostgresRuntime } from "@lovechapter/database";
import { LoveChapterService } from "@lovechapter/domain";

import { createApiIdentityProvider } from "./api-identity";
import { createApiApp } from "./app";
import { approvedBunVersion, parseApiRuntimeConfig } from "./runtime-config";

type FetchHandler = (request: Request) => Promise<Response> | Response;

export function startApiServer(options: {
  fetch: FetchHandler;
  hostname: string;
  port: number;
}): Bun.Server<undefined> {
  return Bun.serve({
    hostname: options.hostname,
    port: options.port,
    idleTimeout: 30,
    maxRequestBodySize: 1_048_576,
    fetch: options.fetch,
  });
}

export function createGracefulHttpLifecycle(options: {
  fetch: FetchHandler;
  close(): Promise<void>;
  forceExit?: (code: number) => void;
  shutdownDeadlineMs?: number;
}): {
  fetch: FetchHandler;
  shutdown(server: Bun.Server<undefined>): Promise<void>;
} {
  let draining = false;
  let shutdownPromise: Promise<void> | undefined;

  return {
    fetch(request) {
      if (draining) {
        return new Response("Service unavailable", {
          status: 503,
          headers: { connection: "close" },
        });
      }
      return options.fetch(request);
    },
    shutdown(server) {
      if (shutdownPromise) return shutdownPromise;
      draining = true;
      shutdownPromise = stopServer(server, options);
      return shutdownPromise;
    },
  };
}

async function stopServer(
  server: Bun.Server<undefined>,
  options: {
    close(): Promise<void>;
    forceExit?: (code: number) => void;
    shutdownDeadlineMs?: number;
  },
): Promise<void> {
  const forceExit = options.forceExit ?? ((code: number) => process.exit(code));
  const deadline = setTimeout(
    () => forceExit(1),
    options.shutdownDeadlineMs ?? 30_000,
  );
  deadline.unref?.();
  try {
    await server.stop(false);
    await options.close();
  } finally {
    clearTimeout(deadline);
  }
}

export function assertApprovedBunVersion(version: string): void {
  if (version !== approvedBunVersion) {
    throw new Error(
      `Bun ${approvedBunVersion} is required; received ${version}`,
    );
  }
}

export async function runApiServer(): Promise<Bun.Server<undefined>> {
  assertApprovedBunVersion(Bun.version);
  const environment = Bun.env as Record<string, string | undefined>;
  const config = parseApiRuntimeConfig(environment);
  const postgres = createPostgresRuntime(config);
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
    {
      ...environment,
      AUTH_MODE: config.authMode,
    },
    {
      authService,
      nodeEnvironment: config.nodeEnvironment,
    },
  );
  const app = createApiApp({
    authService,
    nodeEnvironment: config.nodeEnvironment,
    publicWebOrigin: config.publicWebOrigin,
    proxyCredential: config.proxyCredential,
    fingerprintKey: config.rateLimitHmacKey,
    readiness: async () => {
      await postgres.pool.query("select 1");
    },
    run: (request, operation) =>
      operation(
        new LoveChapterService(
          identity,
          postgres.loveChapterRepository,
          config.publicWebOrigin,
          request,
          postgres.guestImportRepository,
          postgres.envelopeRepository,
        ),
      ),
  }).compile();
  const lifecycle = createGracefulHttpLifecycle({
    fetch: app.fetch,
    close: () => postgres.close(),
  });
  const server = startApiServer({
    fetch: lifecycle.fetch,
    hostname: config.host,
    port: config.port,
  });
  const shutdown = () => {
    void lifecycle.shutdown(server).catch((error: unknown) => {
      console.error("API shutdown failed", error);
      process.exitCode = 1;
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return server;
}

if (import.meta.main) {
  await runApiServer();
}
