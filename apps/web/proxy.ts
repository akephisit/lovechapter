import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { maintenanceResponse } from "./lib/maintenance-response";
import { fetchReleaseState, type ReleaseState } from "./lib/release-state";
import { resolveUiLanguage, UI_LANGUAGE_COOKIE } from "./lib/ui-language";

const probeHeader = "x-lovechapter-release-probe";
const publishedHeader = "x-lovechapter-published-sha";
const safePaths = new Set([
  "/icon.svg",
  "/sw.js",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/health/live",
  "/health/ready",
  "/release-status",
]);

export const config = {
  matcher:
    "/((?!_next/static/|icon\\.svg$|sw\\.js$|manifest\\.webmanifest$|favicon\\.ico$|health/live$|health/ready$).*)",
};

export async function proxy(
  request: NextRequest,
): Promise<NextResponse | Response> {
  const pathname = request.nextUrl.pathname;
  const downstreamHeaders = new Headers(request.headers);
  downstreamHeaders.delete(probeHeader);
  downstreamHeaders.delete(publishedHeader);
  const continueResponse = (publishedSha: string | null = null) => {
    if (publishedSha) downstreamHeaders.set(publishedHeader, publishedSha);
    return NextResponse.next({ request: { headers: downstreamHeaders } });
  };
  if (pathname.startsWith("/_next/static/") || safePaths.has(pathname)) {
    return continueResponse();
  }
  if (pathname === "/ui-language" && request.method === "POST") {
    return continueResponse();
  }
  let state: ReleaseState;
  try {
    state = await fetchReleaseState(request.url, {
      apiUpstreamOrigin: process.env.API_UPSTREAM_ORIGIN ?? "",
      proxySharedSecret: process.env.WEB_PROXY_SHARED_SECRET ?? "",
      fetch,
    });
  } catch {
    state = { mode: "maintenance", publishedSha: null };
  }
  if (state.mode === "open" || isPresentationProbe(request)) {
    return continueResponse(state.mode === "open" ? state.publishedSha : null);
  }
  return maintenanceResponse(
    pathname,
    request.method,
    resolveUiLanguage(
      request.cookies.get(UI_LANGUAGE_COOKIE)?.value,
      request.headers.get("accept-language"),
    ),
  );
}

function isPresentationProbe(request: NextRequest): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const configured = canonicalSecret(process.env.RELEASE_PROBE_SECRET);
  const provided = canonicalSecret(request.headers.get(probeHeader));
  return !!configured && !!provided && timingSafeEqual(configured, provided);
}

function canonicalSecret(value: string | null | undefined): Buffer | null {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const bytes = Buffer.from(value, "base64url");
  return bytes.byteLength === 32 && bytes.toString("base64url") === value
    ? bytes
    : null;
}
