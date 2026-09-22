export type JobsRuntimeConfig = {
  databaseUrl: string;
  databasePoolMax: number;
  publicWebOrigin: string;
  authTokenActiveKeyVersion: number;
  authTokenHmacKeys: ReadonlyMap<number, Uint8Array>;
  resendApiKey: string;
  resendFromEmail: string;
};

export function parseJobsRuntimeConfig(
  environment: Record<string, string | undefined>,
): JobsRuntimeConfig {
  const authTokenActiveKeyVersion = positiveInteger(
    environment.AUTH_TOKEN_ACTIVE_KEY_VERSION,
    "AUTH_TOKEN_ACTIVE_KEY_VERSION",
  );
  const authTokenHmacKeys = signingKeys(environment.AUTH_TOKEN_HMAC_KEYS);
  if (!authTokenHmacKeys.has(authTokenActiveKeyVersion)) {
    throw new Error(
      "AUTH_TOKEN_ACTIVE_KEY_VERSION must identify a key in AUTH_TOKEN_HMAC_KEYS",
    );
  }
  return {
    databaseUrl: required(environment.DATABASE_URL, "DATABASE_URL"),
    databasePoolMax: boundedInteger(
      environment.DATABASE_POOL_MAX,
      2,
      "DATABASE_POOL_MAX",
      1,
      2,
    ),
    publicWebOrigin: httpOrigin(environment.PUBLIC_WEB_ORIGIN),
    authTokenActiveKeyVersion,
    authTokenHmacKeys,
    resendApiKey: required(environment.RESEND_API_KEY, "RESEND_API_KEY"),
    resendFromEmail: emailAddress(environment.RESEND_FROM_EMAIL),
  };
}

function signingKeys(
  value: string | undefined,
): ReadonlyMap<number, Uint8Array> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(required(value, "AUTH_TOKEN_HMAC_KEYS"));
  } catch {
    throw new Error(
      "AUTH_TOKEN_HMAC_KEYS must be a JSON object of signing keys",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "AUTH_TOKEN_HMAC_KEYS must be a JSON object of signing keys",
    );
  }
  const entries = Object.entries(parsed);
  if (entries.length === 0) {
    throw new Error("AUTH_TOKEN_HMAC_KEYS must contain at least one key");
  }
  const keys = new Map<number, Uint8Array>();
  for (const [rawVersion, rawKey] of entries) {
    const version = Number(rawVersion);
    if (
      !Number.isSafeInteger(version) ||
      version < 1 ||
      String(version) !== rawVersion ||
      typeof rawKey !== "string"
    ) {
      throw new Error(
        "AUTH_TOKEN_HMAC_KEYS keys must be canonical positive integers",
      );
    }
    keys.set(version, secretBytes(rawKey, "AUTH_TOKEN_HMAC_KEYS"));
  }
  return keys;
}

function secretBytes(value: string, name: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error(`${name} must contain 32-byte base64url keys`);
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength !== 32 || bytes.toString("base64url") !== value) {
    throw new Error(`${name} must contain 32-byte base64url keys`);
  }
  return new Uint8Array(bytes);
}

function positiveInteger(value: string | undefined, name: string): number {
  const candidate = Number(required(value, name));
  if (!Number.isSafeInteger(candidate) || candidate < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return candidate;
}

function boundedInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const candidate = value === undefined ? fallback : Number(value);
  if (
    !Number.isInteger(candidate) ||
    candidate < minimum ||
    candidate > maximum
  ) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return candidate;
}

function httpOrigin(value: string | undefined): string {
  const configured = required(value, "PUBLIC_WEB_ORIGIN");
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw originError();
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    (url.protocol === "http:" && !isLoopback(url.hostname)) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw originError();
  }
  return url.origin;
}

function isLoopback(hostname: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(
    hostname.toLowerCase(),
  );
}

function emailAddress(value: string | undefined): string {
  const email = required(value, "RESEND_FROM_EMAIL").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) {
    throw new Error("RESEND_FROM_EMAIL must be a valid email address");
  }
  return email;
}

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function originError(): Error {
  return new Error(
    "PUBLIC_WEB_ORIGIN must be an absolute HTTPS origin or loopback HTTP origin",
  );
}
