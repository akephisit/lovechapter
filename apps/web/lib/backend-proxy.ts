const MAX_BODY_BYTES = 1_048_576;
const SUPPORTED_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
] as const;
const REQUEST_HEADER_ALLOWLIST = [
  "accept",
  "accept-language",
  "content-type",
  "cookie",
  "origin",
  "user-agent",
] as const;
const RESPONSE_HEADER_ALLOWLIST = [
  "content-type",
  "cache-control",
  "etag",
  "retry-after",
] as const;

export type ProxyEnvironment = {
  apiUpstreamOrigin: string;
  proxySharedSecret: string;
  fetch: typeof fetch;
};

export async function proxyApiRequest(
  request: Request,
  path: string[],
  environment: ProxyEnvironment,
): Promise<Response> {
  const upstreamOrigin = parseUpstreamOrigin(environment.apiUpstreamOrigin);
  validateProxySecret(environment.proxySharedSecret);
  const method = request.method.toUpperCase();
  if (!(SUPPORTED_METHODS as readonly string[]).includes(method)) {
    return new Response(null, {
      status: 405,
      headers: { allow: SUPPORTED_METHODS.join(", ") },
    });
  }

  const safePath = parsePath(path);
  if (!safePath) return errorResponse(400, "invalid_proxy_path");
  const body = await boundedBody(request);
  if (body === bodyTooLarge) return errorResponse(413, "request_too_large");

  const sourceUrl = new URL(request.url);
  const upstreamUrl = new URL(
    safePath.map((segment) => encodeURIComponent(segment)).join("/"),
    `${upstreamOrigin}/`,
  );
  upstreamUrl.search = sourceUrl.search;
  const headers = new Headers();
  for (const name of REQUEST_HEADER_ALLOWLIST) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  headers.set("x-lovechapter-proxy-secret", environment.proxySharedSecret);
  headers.set(
    "x-lovechapter-client-address",
    request.headers.get("cf-connecting-ip")?.trim() || "local-development",
  );

  const upstreamResponse = await environment.fetch(
    new Request(upstreamUrl, {
      method,
      headers,
      redirect: "manual",
      ...(body === undefined ? {} : { body: body.buffer as ArrayBuffer }),
    }),
  );
  const responseHeaders = new Headers();
  for (const name of RESPONSE_HEADER_ALLOWLIST) {
    const value = upstreamResponse.headers.get(name);
    if (value !== null) responseHeaders.set(name, value);
  }
  for (const cookie of upstreamResponse.headers.getSetCookie()) {
    responseHeaders.append("set-cookie", cookie);
  }
  if (safePath[0] === "v1" && safePath[1] === "auth") {
    responseHeaders.set("cache-control", "no-store");
  }
  return new Response(
    responseMayHaveBody(upstreamResponse.status) ? upstreamResponse.body : null,
    {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    },
  );
}

function parseUpstreamOrigin(value: string): string {
  const configured = value.trim();
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw upstreamError();
  }
  if (
    !configured ||
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw upstreamError();
  }
  return url.origin;
}

function validateProxySecret(value: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error(
      "WEB_PROXY_SHARED_SECRET must contain 32 canonical base64url bytes",
    );
  }
  const bytes = Buffer.from(value, "base64url");
  if (bytes.byteLength !== 32 || bytes.toString("base64url") !== value) {
    throw new Error(
      "WEB_PROXY_SHARED_SECRET must contain 32 canonical base64url bytes",
    );
  }
}

function parsePath(path: string[]): string[] | null {
  if (path.length === 0) return null;
  const result: string[] = [];
  for (const segment of path) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (
      !decoded ||
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      decoded.includes("\0")
    ) {
      return null;
    }
    result.push(decoded);
  }
  return result;
}

const bodyTooLarge = Symbol("body-too-large");

async function boundedBody(
  request: Request,
): Promise<Uint8Array | undefined | typeof bodyTooLarge> {
  if (!request.body) return undefined;
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return bodyTooLarge;
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      return bodyTooLarge;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function responseMayHaveBody(status: number): boolean {
  return status !== 204 && status !== 205 && status !== 304;
}

function errorResponse(status: number, code: string): Response {
  return Response.json(
    { error: { code, message: "Request rejected" } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

function upstreamError(): Error {
  return new Error("API_UPSTREAM_ORIGIN must be an absolute HTTP(S) origin");
}
