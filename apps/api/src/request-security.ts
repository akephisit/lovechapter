import { createHmac, timingSafeEqual } from "node:crypto";

export const PROXY_CREDENTIAL_HEADER = "x-lovechapter-proxy-secret";
export const CLIENT_ADDRESS_HEADER = "x-lovechapter-client-address";

export type IngressSecurityConfig = {
  proxyCredential: string;
  fingerprintKey: Uint8Array;
};

export type AuthorizedIngress =
  { allowed: false } | { allowed: true; fingerprint: string };

export class RequestSecurityError extends Error {
  override readonly name = "RequestSecurityError";

  constructor(
    readonly code:
      | "request_ingress_rejected"
      | "request_origin_rejected"
      | "request_content_type_rejected",
    readonly status: 400 | 403,
  ) {
    super(code);
  }
}

export function authorizeIngress(
  request: Request,
  config: IngressSecurityConfig,
): AuthorizedIngress {
  const actual = request.headers.get(PROXY_CREDENTIAL_HEADER);
  if (!actual || !sameSecret(actual, config.proxyCredential)) {
    return { allowed: false };
  }
  const clientAddress =
    request.headers.get(CLIENT_ADDRESS_HEADER)?.trim() ||
    "proxy-address-unavailable";
  return {
    allowed: true,
    fingerprint: createHmac("sha256", config.fingerprintKey)
      .update(clientAddress)
      .digest("hex"),
  };
}

export function requireMutationOrigin(
  request: Request,
  publicWebOrigin: string,
): void {
  if (request.headers.get("origin") !== publicWebOrigin) {
    throw new RequestSecurityError("request_origin_rejected", 403);
  }
}

export function requireJsonContentType(request: Request): void {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw new RequestSecurityError("request_content_type_rejected", 400);
  }
}

function sameSecret(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.byteLength === expectedBytes.byteLength &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}
