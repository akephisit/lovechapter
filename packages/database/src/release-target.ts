export type ReleaseTargetInput = {
  environment: "staging" | "production";
  neonProjectId: string;
  neonBranchId: string;
  database: string;
  role: string;
  appRole: string;
  directUrl: string;
  cloudflareAccountId: string;
  hyperdriveId: string;
};

export type NeonEndpoint = {
  branch_id: string;
  host: string;
  type: string;
};

export type HyperdriveConfig = {
  id: string;
  origin: { host: string; database: string; user: string };
  caching: { disabled: boolean };
};

export type ReleaseInventory = {
  neonEndpoints: NeonEndpoint[];
  hyperdrive: HyperdriveConfig;
};

export type VerifiedReleaseTarget = {
  environment: "staging" | "production";
  branchId: string;
  role: string;
  database: string;
  host: string;
};

export type InventoryCredentials = {
  neonApiKey: string;
  cloudflareApiToken: string;
};

function required(value: string, name: string): string {
  if (!value || !value.trim() || /^REPLACE_WITH_/iu.test(value)) {
    throw new Error(`${name} is required`);
  }
  return value;
}

export function validateDirectDatabaseUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("RELEASE_DATABASE_URL is invalid");
  }
  const channelBindings = url.searchParams.getAll("channel_binding");
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !url.password ||
    (url.port !== "" && url.port !== "5432") ||
    /(?:^|[-.])(?:pooler|pgbouncer)(?:[.-]|$)/iu.test(url.hostname) ||
    [...url.searchParams.keys()].some(
      (name) => name !== "sslmode" && name !== "channel_binding",
    ) ||
    url.searchParams.getAll("sslmode").length !== 1 ||
    !["require", "verify-full"].includes(
      url.searchParams.get("sslmode") ?? "",
    ) ||
    channelBindings.length > 1 ||
    (channelBindings.length === 1 && channelBindings[0] !== "require") ||
    !/^\/[a-zA-Z0-9_%-]+$/u.test(url.pathname)
  ) {
    throw new Error("RELEASE_DATABASE_URL must be a direct TLS PostgreSQL URL");
  }
  return url;
}

export function verifyReleaseTarget(
  input: ReleaseTargetInput,
  inventory: ReleaseInventory,
): VerifiedReleaseTarget {
  const url = validateDirectDatabaseUrl(input.directUrl);
  for (const [name, value] of [
    ["Neon project ID", input.neonProjectId],
    ["Neon branch ID", input.neonBranchId],
    ["database", input.database],
    ["role", input.role],
    ["application role", input.appRole],
    ["Cloudflare account ID", input.cloudflareAccountId],
    ["Hyperdrive ID", input.hyperdriveId],
  ] as const) {
    required(value, name);
  }
  if (
    decodeURIComponent(url.username) !== input.role ||
    decodeURIComponent(url.pathname.slice(1)) !== input.database
  ) {
    throw new Error("Release database role or name does not match inventory");
  }
  if (input.role === input.appRole) {
    throw new Error("Release and application database roles must differ");
  }
  const matchingEndpoints = inventory.neonEndpoints.filter(
    (endpoint) =>
      endpoint.branch_id === input.neonBranchId &&
      endpoint.host === url.hostname &&
      endpoint.type === "read_write",
  );
  if (matchingEndpoints.length !== 1) {
    throw new Error("Release URL is not the selected Neon branch endpoint");
  }
  const hyperdrive = inventory.hyperdrive;
  if (
    hyperdrive.id !== input.hyperdriveId ||
    hyperdrive.origin.host !== url.hostname ||
    hyperdrive.origin.database !== input.database ||
    hyperdrive.origin.user !== input.appRole ||
    hyperdrive.caching.disabled !== true
  ) {
    throw new Error("Hyperdrive does not match the selected release target");
  }
  return {
    environment: input.environment,
    branchId: input.neonBranchId,
    role: input.role,
    database: input.database,
    host: url.hostname,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseNeonEndpoints(value: unknown): NeonEndpoint[] {
  const endpoints = record(value)?.endpoints;
  if (!Array.isArray(endpoints)) {
    throw new Error("Neon inventory unavailable");
  }
  return endpoints.map((item) => {
    const endpoint = record(item);
    if (
      typeof endpoint?.branch_id !== "string" ||
      typeof endpoint.host !== "string" ||
      typeof endpoint.type !== "string"
    ) {
      throw new Error("Neon inventory unavailable");
    }
    return {
      branch_id: endpoint.branch_id,
      host: endpoint.host,
      type: endpoint.type,
    };
  });
}

function parseHyperdrive(value: unknown): HyperdriveConfig {
  const envelope = record(value);
  const result = record(envelope?.result);
  const origin = record(result?.origin);
  const caching = record(result?.caching);
  if (
    envelope?.success !== true ||
    typeof result?.id !== "string" ||
    typeof origin?.host !== "string" ||
    typeof origin.database !== "string" ||
    typeof origin.user !== "string" ||
    typeof caching?.disabled !== "boolean"
  ) {
    throw new Error("Hyperdrive inventory unavailable");
  }
  return {
    id: result.id,
    origin: {
      host: origin.host,
      database: origin.database,
      user: origin.user,
    },
    caching: { disabled: caching.disabled },
  };
}

async function fetchInventoryJson(
  fetcher: typeof fetch,
  url: string,
  token: string,
  provider: "Neon" | "Hyperdrive",
): Promise<unknown> {
  try {
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!response.ok) throw new Error("provider error");
    return await response.json();
  } catch {
    throw new Error(`${provider} inventory unavailable`);
  }
}

export async function loadReleaseInventory(
  input: ReleaseTargetInput,
  credentials: InventoryCredentials,
  fetcher: typeof fetch = fetch,
): Promise<ReleaseInventory> {
  const project = encodeURIComponent(
    required(input.neonProjectId, "Neon project ID"),
  );
  const branch = encodeURIComponent(
    required(input.neonBranchId, "Neon branch ID"),
  );
  const account = encodeURIComponent(
    required(input.cloudflareAccountId, "Cloudflare account ID"),
  );
  const hyperdrive = encodeURIComponent(
    required(input.hyperdriveId, "Hyperdrive ID"),
  );
  const neonToken = required(credentials.neonApiKey, "Neon API key");
  const cloudflareToken = required(
    credentials.cloudflareApiToken,
    "Cloudflare API token",
  );
  const neon = await fetchInventoryJson(
    fetcher,
    `https://console.neon.tech/api/v2/projects/${project}/branches/${branch}/endpoints`,
    neonToken,
    "Neon",
  );
  const cloudflare = await fetchInventoryJson(
    fetcher,
    `https://api.cloudflare.com/client/v4/accounts/${account}/hyperdrive/configs/${hyperdrive}`,
    cloudflareToken,
    "Hyperdrive",
  );
  return {
    neonEndpoints: parseNeonEndpoints(neon),
    hyperdrive: parseHyperdrive(cloudflare),
  };
}
