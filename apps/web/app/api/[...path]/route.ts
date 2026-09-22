import { proxyApiRequest } from "../../../lib/backend-proxy";

type RouteContext = { params: Promise<{ path: string[] }> };

async function handle(request: Request, context: RouteContext) {
  const { path } = await context.params;
  return proxyApiRequest(request, path, {
    apiUpstreamOrigin: process.env.API_UPSTREAM_ORIGIN ?? "",
    proxySharedSecret: process.env.WEB_PROXY_SHARED_SECRET ?? "",
    fetch,
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;
