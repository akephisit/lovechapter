export const approvedBunVersion = "1.4.2" as const;

export type ApiRuntimeConfig = {
  bunVersion: typeof approvedBunVersion;
  nodeEnvironment: "development" | "test" | "production";
  host: string;
  port: number;
  databaseUrl: string;
  databasePoolMax: number;
  publicWebOrigin: string;
  authMode: "disabled" | "development" | "local";
  proxyCredential: string;
  rateLimitHmacKey: Uint8Array;
  authTokenActiveKeyVersion: number;
  authTokenHmacKeys: ReadonlyMap<number, Uint8Array>;
};

export type ApiRuntimeEnvironment = Record<string, string | undefined>;

export function parseApiRuntimeConfig(
  environment: ApiRuntimeEnvironment,
): ApiRuntimeConfig {
  const nodeEnvironment = enumValue(
    environment.NODE_ENV ?? "development",
    "NODE_ENV",
    ["development", "test", "production"] as const,
  );
  const authMode = enumValue(environment.AUTH_MODE ?? "disabled", "AUTH_MODE", [
    "disabled",
    "development",
    "local",
  ] as const);

  if (nodeEnvironment === "production" && authMode === "development") {
    throw new Error("AUTH_MODE=development is forbidden in production");
  }

  const authTokenActiveKeyVersion = positiveInteger(
    environment.AUTH_TOKEN_ACTIVE_KEY_VERSION,
    "AUTH_TOKEN_ACTIVE_KEY_VERSION",
  );
  const authTokenHmacKeys = secretMap(
    environment.AUTH_TOKEN_HMAC_KEYS,
    "AUTH_TOKEN_HMAC_KEYS",
  );
  if (!authTokenHmacKeys.has(authTokenActiveKeyVersion)) {
    throw new Error(
      "AUTH_TOKEN_ACTIVE_KEY_VERSION must identify a key in AUTH_TOKEN_HMAC_KEYS",
    );
  }

  return {
    bunVersion: approvedBunVersion,
    nodeEnvironment,
    host: optionalNonEmpty(environment.API_HOST, "127.0.0.1", "API_HOST"),
    port: boundedInteger(environment.API_PORT, 3001, "API_PORT", 1, 65_535),
    databaseUrl: required(environment.DATABASE_URL, "DATABASE_URL"),
    databasePoolMax: boundedInteger(
      environment.DATABASE_POOL_MAX,
      6,
      "DATABASE_POOL_MAX",
      1,
      6,
    ),
    publicWebOrigin: httpOrigin(environment.PUBLIC_WEB_ORIGIN),
    authMode,
    proxyCredential: secretString(
      environment.WEB_PROXY_SHARED_SECRET,
      "WEB_PROXY_SHARED_SECRET",
    ),
    rateLimitHmacKey: secretBytes(
      environment.RATE_LIMIT_HMAC_KEY,
      "RATE_LIMIT_HMAC_KEY",
    ),
    authTokenActiveKeyVersion,
    authTokenHmacKeys,
  };
}

function positiveInteger(value: string | undefined, name: string): number {
  const candidate = Number(required(value, name));
  if (!Number.isSafeInteger(candidate) || candidate < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return candidate;
}

function secretMap(
  value: string | undefined,
  name: string,
): ReadonlyMap<number, Uint8Array> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(required(value, name));
  } catch {
    throw new Error(`${name} must be a JSON object of signing keys`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object of signing keys`);
  }
  const entries = Object.entries(parsed);
  if (entries.length === 0) {
    throw new Error(`${name} must contain at least one signing key`);
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
        `${name} keys must be canonical positive integer versions`,
      );
    }
    keys.set(version, secretBytes(rawKey, name));
  }
  return keys;
}

function secretString(value: string | undefined, name: string): string {
  const secret = required(value, name);
  secretBytes(secret, name);
  return secret;
}

function secretBytes(value: string | undefined, name: string): Uint8Array {
  const secret = required(value, name);
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) {
    throw new Error(`${name} must be 32 random base64url bytes`);
  }
  const bytes = Buffer.from(secret, "base64url");
  if (bytes.byteLength !== 32 || bytes.toString("base64url") !== secret) {
    throw new Error(`${name} must be 32 random base64url bytes`);
  }
  return new Uint8Array(bytes);
}

function enumValue<const T extends readonly string[]>(
  value: string,
  name: string,
  allowed: T,
): T[number] {
  if (!allowed.includes(value)) {
    throw new Error(`${name} must be one of: ${allowed.join(", ")}`);
  }
  return value as T[number];
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

function required(value: string | undefined, name: string): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function optionalNonEmpty(
  value: string | undefined,
  fallback: string,
  name: string,
): string {
  return value === undefined ? fallback : required(value, name);
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

function originError(): Error {
  return new Error(
    "PUBLIC_WEB_ORIGIN must be an absolute HTTPS origin or loopback HTTP origin",
  );
}
