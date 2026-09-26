import type { ReleaseGateStore } from "@lovechapter/database";

import {
  authorizeIngress,
  type IngressSecurityConfig,
} from "./request-security";

function maintenanceResponse(): Response {
  return Response.json(
    {
      error: {
        code: "maintenance",
        message: "Service temporarily unavailable",
      },
    },
    {
      status: 503,
      headers: { "cache-control": "no-store", "retry-after": "60" },
    },
  );
}

export async function withApiAdmission(
  request: Request,
  gate: ReleaseGateStore,
  ingress: IngressSecurityConfig,
  handle: () => Promise<Response>,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path === "/health/live") return handle();
  if (!authorizeIngress(request, ingress).allowed) {
    return Response.json(
      {
        error: {
          code: "request_ingress_rejected",
          message: "Request rejected",
        },
      },
      { status: 403, headers: { "cache-control": "no-store" } },
    );
  }
  if (
    path === "/health/ready" ||
    (path === "/health/release-state" && request.method === "GET")
  ) {
    return handle();
  }
  let lease: string | null;
  try {
    lease = await gate.admit("http");
  } catch {
    return maintenanceResponse();
  }
  if (!lease) return maintenanceResponse();
  let response: Response;
  try {
    response = await handle();
  } catch (error) {
    await gate.release(lease);
    throw error;
  }
  if (!response.body) {
    await gate.release(lease);
    return response;
  }
  const reader = response.body.getReader();
  let releasePromise: Promise<void> | undefined;
  const release = () => (releasePromise ??= gate.release(lease));
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          await release();
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (error) {
        try {
          await release();
        } finally {
          controller.error(error);
        }
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        await release();
      }
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
