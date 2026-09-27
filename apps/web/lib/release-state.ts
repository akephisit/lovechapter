import {
  parseUpstreamOrigin,
  validateProxySecret,
  type ProxyEnvironment,
} from "./backend-proxy";

export type ReleaseMode = "open" | "maintenance";
export type ReleaseState = {
  mode: ReleaseMode;
  publishedSha: string | null;
};

export async function fetchReleaseState(
  requestUrl: string,
  environment: ProxyEnvironment,
): Promise<ReleaseState> {
  const upstreamOrigin = parseUpstreamOrigin(environment.apiUpstreamOrigin);
  if (upstreamOrigin === new URL(requestUrl).origin) {
    throw new Error("API_UPSTREAM_ORIGIN must differ from the frontend origin");
  }
  validateProxySecret(environment.proxySharedSecret);
  const abort = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort();
      reject(new Error("Release control timed out"));
    }, 3_000);
  });
  try {
    return await Promise.race([
      (async () => {
        const response = await environment.fetch(
          new Request(`${upstreamOrigin}/health/release-state`, {
            method: "GET",
            redirect: "manual",
            cache: "no-store",
            signal: abort.signal,
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
          Object.keys(state).length !== 2 ||
          !("mode" in state) ||
          (state.mode !== "open" && state.mode !== "maintenance") ||
          !("publishedSha" in state) ||
          (state.publishedSha !== null &&
            (typeof state.publishedSha !== "string" ||
              !/^[0-9a-f]{40}$/u.test(state.publishedSha))) ||
          (state.mode === "maintenance" && state.publishedSha !== null)
        ) {
          throw new Error("Release control state is invalid");
        }
        return {
          mode: state.mode as ReleaseMode,
          publishedSha: state.publishedSha as string | null,
        };
      })(),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}
