import { URL } from "node:url";

import { describe, expect, it } from "vitest";

const accountId = "4b8287e143531729dec988559f6721ef";
const hyperdriveId = "e55ad44368d04224aa7ba4af95173e23";
const environment = {
  GITHUB_ACTIONS: "true",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  GITHUB_REF_PROTECTED: "true",
  GITHUB_REPOSITORY: "akephisit/lovechapter",
  RELEASE_CLOUDFLARE_ACCOUNT_ID: accountId,
  RELEASE_HYPERDRIVE_ID: hyperdriveId,
  RELEASE_CLOUDFLARE_API_TOKEN: "cfat_test_only",
};

describe("staging Cloudflare credential probe", () => {
  it("reports a denied Hyperdrive read without exposing provider details", async () => {
    const { probeStagingCloudflareCredential } =
      await import("./staging-cloudflare-credential-probe.mjs");
    const fetcher = async () =>
      globalThis.Response.json(
        { errors: [{ message: "private-provider-message" }] },
        { status: 403 },
      );

    await expect(
      probeStagingCloudflareCredential(environment, { fetcher }),
    ).rejects.toThrow("staging_cloudflare_hyperdrive_http_403");
  });

  it("rejects an unprotected ref before using the credential", async () => {
    const { probeStagingCloudflareCredential } =
      await import("./staging-cloudflare-credential-probe.mjs");
    let calls = 0;
    const fetcher = () => {
      calls += 1;
      throw new Error("network must not be reached");
    };

    await expect(
      probeStagingCloudflareCredential(
        { ...environment, GITHUB_REF_PROTECTED: "false" },
        { fetcher },
      ),
    ).rejects.toThrow("Staging Cloudflare credential probe failed");
    expect(calls).toBe(0);
  });

  it("reads only the selected Hyperdrive and two staging Worker inventories", async () => {
    const { probeStagingCloudflareCredential } =
      await import("./staging-cloudflare-credential-probe.mjs");
    const paths = [];
    const fetcher = async (url, options) => {
      paths.push(new URL(url).pathname);
      expect(options.method).toBe("GET");
      expect(options.redirect).toBe("error");
      expect(options.headers.Authorization).toBe("Bearer cfat_test_only");
      if (url.includes("/hyperdrive/configs/")) {
        return globalThis.Response.json({
          success: true,
          result: { id: hyperdriveId, caching: { disabled: true } },
        });
      }
      if (url.endsWith("/subdomain")) {
        return globalThis.Response.json({
          success: true,
          result: { previews_enabled: false },
        });
      }
      return globalThis.Response.json({
        success: true,
        result: {
          deployments: [
            {
              versions: [{ version_id: "staging-version", percentage: 100 }],
            },
          ],
        },
      });
    };

    await expect(
      probeStagingCloudflareCredential(environment, { fetcher }),
    ).resolves.toEqual({
      hyperdriveId,
      workerNames: ["lovechapter-api-staging", "lovechapter-web-staging"],
    });
    expect(paths).toEqual([
      `/client/v4/accounts/${accountId}/hyperdrive/configs/${hyperdriveId}`,
      `/client/v4/accounts/${accountId}/workers/scripts/lovechapter-api-staging/deployments`,
      `/client/v4/accounts/${accountId}/workers/scripts/lovechapter-api-staging/subdomain`,
      `/client/v4/accounts/${accountId}/workers/scripts/lovechapter-web-staging/deployments`,
      `/client/v4/accounts/${accountId}/workers/scripts/lovechapter-web-staging/subdomain`,
    ]);
  });
});
