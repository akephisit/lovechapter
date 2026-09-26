import {
  parseUpstreamOrigin,
  validateProxySecret,
  type ProxyEnvironment,
} from "./backend-proxy";

export type ReleaseMode = "open" | "maintenance";

export async function fetchReleaseMode(
  requestUrl: string,
  environment: ProxyEnvironment,
): Promise<ReleaseMode> {
  const upstreamOrigin = parseUpstreamOrigin(environment.apiUpstreamOrigin);
  if (upstreamOrigin === new URL(requestUrl).origin) {
    throw new Error("API_UPSTREAM_ORIGIN must differ from the frontend origin");
  }
  validateProxySecret(environment.proxySharedSecret);
  const response = await environment.fetch(
    new Request(`${upstreamOrigin}/health/release-state`, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers: {
        "cache-control": "no-store",
        "x-lovechapter-proxy-secret": environment.proxySharedSecret,
      },
    }),
  );
  if (!response.ok) throw new Error("Release control is unavailable");
  const state: unknown = await response.json();
  if (
    !state ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    Object.keys(state).length !== 1 ||
    !("mode" in state) ||
    (state.mode !== "open" && state.mode !== "maintenance")
  ) {
    throw new Error("Release control state is invalid");
  }
  return state.mode;
}
