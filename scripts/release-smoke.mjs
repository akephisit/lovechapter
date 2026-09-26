import { Buffer } from "node:buffer";
import { URL } from "node:url";

const shaPattern = /^[0-9a-f]{40}$/u;
const secretPattern = /^[A-Za-z0-9_-]{43}$/u;

function canonicalSecret(value) {
  if (typeof value !== "string" || !secretPattern.test(value)) return false;
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === value;
}

function workerOrigin(value) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname.endsWith(".workers.dev") ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
}

function validVersion(value) {
  return (
    typeof value?.versionId === "string" &&
    value.versionId.length > 0 &&
    shaPattern.test(value.sourceSha ?? "")
  );
}

function validateInput(input, now) {
  const webOrigin = workerOrigin(input?.webOrigin);
  const apiOrigin = workerOrigin(input?.apiOrigin);
  if (
    !shaPattern.test(input?.sha ?? "") ||
    !webOrigin ||
    !apiOrigin ||
    webOrigin === apiOrigin ||
    !canonicalSecret(input?.proxySecret) ||
    !canonicalSecret(input?.probeSecret) ||
    input.proxySecret === input.probeSecret ||
    input.closure?.mode !== "maintenance" ||
    input.closure.targetSha !== input.sha ||
    !Number.isFinite(Date.parse(input.closure.changedAt ?? "")) ||
    !validVersion(input.deployed?.web) ||
    !validVersion(input.deployed?.api) ||
    typeof now !== "function"
  ) {
    throw new Error("Private release smoke inputs are incomplete");
  }
  return { webOrigin, apiOrigin };
}

/** Prove the new Worker pair is ready while ordinary traffic remains closed. */
export async function runPrivateReleaseSmoke(
  input,
  { fetcher = globalThis.fetch, now = () => new Date() } = {},
) {
  const { webOrigin, apiOrigin } = validateInput(input, now);
  if (typeof fetcher !== "function") {
    throw new Error("Private release smoke fetcher is unavailable");
  }
  const proxyHeaders = { "x-lovechapter-proxy-secret": input.proxySecret };
  async function request(origin, path, options = {}) {
    return fetcher(`${origin}${path}`, {
      redirect: "manual",
      cache: "no-store",
      signal: globalThis.AbortSignal.timeout(20_000),
      ...options,
    });
  }
  async function requireStatus(origin, path, expected, options) {
    const response = await request(origin, path, options);
    if (response.status !== expected) {
      throw new Error("status mismatch");
    }
    return response;
  }
  async function requireClosedState() {
    const response = await requireStatus(
      apiOrigin,
      "/health/release-state",
      200,
      {
        headers: proxyHeaders,
      },
    );
    const state = await response.json();
    if (
      !state ||
      Object.keys(state).length !== 1 ||
      state.mode !== "maintenance"
    ) {
      throw new Error("gate opened unexpectedly");
    }
  }
  try {
    await requireStatus(apiOrigin, "/health/live", 200);
    await requireStatus(apiOrigin, "/health/ready", 200, {
      headers: proxyHeaders,
    });
    await requireClosedState();
    await requireStatus(apiOrigin, "/v1/auth/session", 403);
    await requireStatus(apiOrigin, "/v1/auth/forgot-password", 503, {
      method: "POST",
      headers: {
        ...proxyHeaders,
        Origin: webOrigin,
        "content-type": "application/json",
      },
      body: "{}",
    });
    const maintenance = await requireStatus(webOrigin, "/sign-in", 503);
    if (!maintenance.headers.get("content-type")?.startsWith("text/html")) {
      throw new Error("maintenance presentation is missing");
    }
    const presentation = await requireStatus(webOrigin, "/sign-in", 200, {
      headers: { "x-lovechapter-release-probe": input.probeSecret },
    });
    if (!presentation.headers.get("content-type")?.startsWith("text/html")) {
      throw new Error("private presentation is missing");
    }
    await requireStatus(webOrigin, "/api/v1/auth/session", 503, {
      headers: { "x-lovechapter-release-probe": input.probeSecret },
    });
    await requireStatus(webOrigin, "/api/v1/auth/forgot-password", 503, {
      method: "POST",
      headers: { Origin: webOrigin, "content-type": "application/json" },
      body: "{}",
    });
    await requireClosedState();
    const acceptedAt = now().toISOString();
    if (Date.parse(acceptedAt) <= Date.parse(input.closure.changedAt)) {
      throw new Error("acceptance predates closure");
    }
    return { passed: true, acceptedAt };
  } catch {
    // Provider responses and request credentials must never reach release logs.
    throw new Error("Private release smoke failed");
  }
}

/** Verify public ingress after reopen; staging's mutation checks run separately. */
export async function runPublicReleaseCheck(
  input,
  { fetcher = globalThis.fetch } = {},
) {
  const webOrigin = workerOrigin(input?.webOrigin);
  const apiOrigin = workerOrigin(input?.apiOrigin);
  if (
    !shaPattern.test(input?.sha ?? "") ||
    !webOrigin ||
    !apiOrigin ||
    webOrigin === apiOrigin ||
    !canonicalSecret(input.proxySecret) ||
    input.opened?.mode !== "open" ||
    input.opened.targetSha !== input.sha ||
    !["web", "api"].every(
      (component) =>
        validVersion(input.deployed?.[component]) &&
        input.opened[component]?.versionId ===
          input.deployed[component].versionId &&
        input.opened[component]?.sourceSha ===
          input.deployed[component].sourceSha,
    ) ||
    typeof fetcher !== "function"
  ) {
    throw new Error("Public release check inputs are incomplete");
  }
  const proxyHeaders = { "x-lovechapter-proxy-secret": input.proxySecret };
  async function request(origin, path, options = {}) {
    return fetcher(`${origin}${path}`, {
      redirect: "manual",
      cache: "no-store",
      signal: globalThis.AbortSignal.timeout(20_000),
      ...options,
    });
  }
  async function requireStatus(origin, path, expected, options) {
    const response = await request(origin, path, options);
    if (response.status !== expected) throw new Error("status mismatch");
    return response;
  }
  async function requireOpenState() {
    const response = await requireStatus(
      apiOrigin,
      "/health/release-state",
      200,
      {
        headers: proxyHeaders,
      },
    );
    const state = await response.json();
    if (!state || Object.keys(state).length !== 1 || state.mode !== "open") {
      throw new Error("gate closed unexpectedly");
    }
  }
  try {
    await requireOpenState();
    await requireStatus(apiOrigin, "/health/ready", 200, {
      headers: proxyHeaders,
    });
    await requireStatus(apiOrigin, "/v1/auth/session", 403);
    const page = await requireStatus(webOrigin, "/sign-in", 200);
    if (!page.headers.get("content-type")?.startsWith("text/html")) {
      throw new Error("public presentation is missing");
    }
    await requireStatus(webOrigin, "/api/v1/auth/session", 401);
    await requireOpenState();
    return { passed: true };
  } catch {
    throw new Error("Public release check failed");
  }
}
