import { createHash, createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  authorizeIngress,
  CLIENT_ADDRESS_HEADER,
  PROXY_CREDENTIAL_HEADER,
  requireJsonContentType,
  isGuestCsvUpload,
  requireGuestCsvContentType,
  requireMutationOrigin,
} from "./request-security";

const proxyCredential = "proxy-credential-that-is-at-least-32-bytes";
const fingerprintKey = new Uint8Array(32).fill(7);
const config = { proxyCredential, fingerprintKey };

describe("trusted proxy request security", () => {
  it("accepts text/csv only on the exact wedding upload path", () => {
    const upload = new Request(
      "https://api.example.test/v1/weddings/018f0000-0000-7000-8000-000000000001/guest-imports",
      {
        method: "POST",
        headers: {
          "content-type": "text/csv; charset=utf-8",
          origin: "https://web.example.test",
        },
        body: "name\nNok\n",
      },
    );
    expect(isGuestCsvUpload(upload)).toBe(true);
    expect(() => requireGuestCsvContentType(upload)).not.toThrow();
    expect(
      isGuestCsvUpload(
        new Request(`${upload.url}/batch/commit`, { method: "POST" }),
      ),
    ).toBe(false);
    expect(isGuestCsvUpload(new Request(upload.url, { method: "PATCH" }))).toBe(
      false,
    );
    expect(() =>
      requireGuestCsvContentType(
        new Request(upload.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      ),
    ).toThrow("request_content_type_rejected");
  });
  it("rejects browser-spoofed client metadata without the proxy credential", () => {
    const request = new Request("https://api.example.test/v1/me", {
      headers: { [CLIENT_ADDRESS_HEADER]: "203.0.113.10" },
    });

    expect(authorizeIngress(request, config)).toEqual({ allowed: false });
  });

  it("accepts proxy metadata only after a timing-safe credential check", () => {
    const request = new Request("https://api.example.test/v1/me", {
      headers: {
        [PROXY_CREDENTIAL_HEADER]: proxyCredential,
        [CLIENT_ADDRESS_HEADER]: "203.0.113.10",
      },
    });

    expect(authorizeIngress(request, config)).toEqual({
      allowed: true,
      fingerprint: createHmac("sha256", fingerprintKey)
        .update("203.0.113.10")
        .digest("hex"),
    });
  });

  it("uses a fixed missing-address fingerprint without trusting request headers", () => {
    const request = new Request("https://api.example.test/v1/me", {
      headers: { [PROXY_CREDENTIAL_HEADER]: proxyCredential },
    });

    expect(authorizeIngress(request, config)).toEqual({
      allowed: true,
      fingerprint: createHmac("sha256", fingerprintKey)
        .update("proxy-address-unavailable")
        .digest("hex"),
    });
  });

  it("rejects a cross-origin mutation with a stable reason code", () => {
    const request = new Request("https://api.example.test/v1/auth/sign-in", {
      method: "POST",
      headers: { origin: "https://attacker.example" },
    });

    expect(() =>
      requireMutationOrigin(request, "https://web.example.test"),
    ).toThrow("request_origin_rejected");
  });

  it("requires an exact JSON media type on mutations", () => {
    const request = new Request("https://api.example.test/v1/auth/sign-in", {
      method: "POST",
      headers: { "content-type": "text/plain" },
    });

    expect(() => requireJsonContentType(request)).toThrow(
      "request_content_type_rejected",
    );
  });

  it("never exposes the proxy credential through its fingerprint", () => {
    const request = new Request("https://api.example.test/v1/me", {
      headers: {
        [PROXY_CREDENTIAL_HEADER]: proxyCredential,
        [CLIENT_ADDRESS_HEADER]: "198.51.100.9",
      },
    });
    const result = authorizeIngress(request, config);

    expect(result).toMatchObject({ allowed: true });
    if (result.allowed) {
      expect(result.fingerprint).not.toBe(
        createHash("sha256").update(proxyCredential).digest("hex"),
      );
      expect(result.fingerprint).not.toContain("198.51.100.9");
    }
  });
});
