import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { maintenanceResponse } from "./lib/maintenance-response";
import { fetchReleaseMode } from "./lib/release-state";

const probeHeader = "x-lovechapter-release-probe";
const safePaths = new Set([
  "/icon.svg",
  "/sw.js",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/health/live",
  "/health/ready",
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
  const continueResponse = () =>
    NextResponse.next({ request: { headers: downstreamHeaders } });
  if (pathname.startsWith("/_next/static/") || safePaths.has(pathname)) {
    return continueResponse();
  }
  let mode: "open" | "maintenance";
  try {
    mode = await fetchReleaseMode(request.url, {
      apiUpstreamOrigin: process.env.API_UPSTREAM_ORIGIN ?? "",
      proxySharedSecret: process.env.WEB_PROXY_SHARED_SECRET ?? "",
      fetch,
    });
  } catch {
    mode = "maintenance";
  }
  if (mode === "open" || isPresentationProbe(request)) {
    return continueResponse();
  }
  return maintenanceResponse(pathname, request.method);
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
