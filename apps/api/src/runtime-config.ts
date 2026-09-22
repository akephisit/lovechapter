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
  };
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

function originError(): Error {
  return new Error("PUBLIC_WEB_ORIGIN must be an absolute HTTP(S) origin");
}
