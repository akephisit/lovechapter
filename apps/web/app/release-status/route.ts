import { fetchReleaseState } from "../../lib/release-state";

export async function GET(request: Request): Promise<Response> {
  try {
    const state = await fetchReleaseState(request.url, {
      apiUpstreamOrigin: process.env.API_UPSTREAM_ORIGIN ?? "",
      proxySharedSecret: process.env.WEB_PROXY_SHARED_SECRET ?? "",
      fetch,
    });
    return Response.json(state, {
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return Response.json(
      { mode: "maintenance", publishedSha: null },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
