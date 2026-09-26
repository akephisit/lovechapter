import { createPostgresRuntime } from "@lovechapter/database";

import { createApiHandler } from "./api-handler";
import { approvedBunVersion, parseApiRuntimeConfig } from "./runtime-config";
import { withApiAdmission } from "./release-admission";

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
  const app = createApiHandler(environment, config, {
    ...postgres,
    readiness: async () => {
      await postgres.pool.query("select 1");
    },
  });
  const lifecycle = createGracefulHttpLifecycle({
    fetch: (request) =>
      withApiAdmission(
        request,
        postgres.releaseGateStore,
        {
          proxyCredential: config.proxyCredential,
          fingerprintKey: config.rateLimitHmacKey,
        },
        async () => app.fetch(request),
      ),
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
