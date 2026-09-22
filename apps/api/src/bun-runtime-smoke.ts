import { createApiApp } from "./app";
import {
  assertApprovedBunVersion,
  createGracefulHttpLifecycle,
  startApiServer,
} from "./server";

assertApprovedBunVersion(Bun.version);

const app = createApiApp({
  publicWebOrigin: "http://localhost:3000",
  readiness: async () => {
    throw new Error("The Bun smoke test must not connect to PostgreSQL");
  },
  run: async () => {
    throw new Error("The Bun smoke test must not run application traffic");
  },
}).compile();
let closed = false;
const lifecycle = createGracefulHttpLifecycle({
  fetch: app.fetch,
  close: async () => {
    closed = true;
  },
});
const server = startApiServer({
  fetch: lifecycle.fetch,
  hostname: "127.0.0.1",
  port: 0,
});

try {
  const response = await fetch(
    `http://${server.hostname}:${server.port}/health/live`,
  );
  const body = (await response.json()) as { status?: unknown };
  if (response.status !== 200 || body.status !== "ok") {
    throw new Error(
      `Unexpected live-health response: ${response.status} ${JSON.stringify(body)}`,
    );
  }
} finally {
  await lifecycle.shutdown(server);
}

if (!closed) throw new Error("Graceful shutdown did not close resources");
console.log("Bun runtime smoke passed");
