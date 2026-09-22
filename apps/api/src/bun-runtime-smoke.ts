import { createApiApp } from "./app";
import {
  assertApprovedBunVersion,
  createGracefulHttpLifecycle,
  startApiServer,
} from "./server";

assertApprovedBunVersion(Bun.version);

const rejectApplicationTraffic = async (): Promise<never> => {
  throw new Error("The Bun smoke test must not run application traffic");
};

const app = createApiApp({
  authService: {
    signUp: rejectApplicationTraffic,
    resendVerificationEmail: rejectApplicationTraffic,
    verifyEmail: rejectApplicationTraffic,
    signIn: rejectApplicationTraffic,
    resolveSession: rejectApplicationTraffic,
    signOut: rejectApplicationTraffic,
    forgotPassword: rejectApplicationTraffic,
    resetPassword: rejectApplicationTraffic,
  },
  nodeEnvironment: "test",
  publicWebOrigin: "http://localhost:3000",
  proxyCredential: "proxy-credential-that-is-at-least-32-bytes",
  fingerprintKey: new Uint8Array(32),
  readiness: async () => {
    throw new Error("The Bun smoke test must not connect to PostgreSQL");
  },
  run: rejectApplicationTraffic,
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
