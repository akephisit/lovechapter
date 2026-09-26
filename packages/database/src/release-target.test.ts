import { describe, expect, it, vi } from "vitest";

import {
  loadReleaseInventory,
  verifyReleaseTarget,
  type ReleaseTargetInput,
} from "./release-target";

export const stagingTarget: ReleaseTargetInput = {
  environment: "staging",
  neonProjectId: "icy-hat-79862899",
  neonBranchId: "br-staging-123",
  database: "lovechapter",
  role: "staging_release",
  appRole: "staging_app",
  directUrl:
    "postgresql://staging_release:private-password@ep-staging.ap-southeast-1.aws.neon.tech/lovechapter?sslmode=require",
  cloudflareAccountId: "cf-account-123",
  hyperdriveId: "staging-hyperdrive-123",
};

export const productionTarget: ReleaseTargetInput = {
  ...stagingTarget,
  environment: "production",
  neonBranchId: "br-production-456",
  role: "production_release",
  appRole: "production_app",
  directUrl:
    "postgresql://production_release:private-password@ep-production.ap-southeast-1.aws.neon.tech/lovechapter?sslmode=require",
  hyperdriveId: "production-hyperdrive-456",
};

export function inventoryFor(target: ReleaseTargetInput) {
  const host = new URL(target.directUrl).hostname;
  return {
    neonEndpoints: [
      { branch_id: target.neonBranchId, host, type: "read_write" },
    ],
    hyperdrive: {
      id: target.hyperdriveId,
      origin: { host, database: target.database, user: target.appRole },
      caching: { disabled: true },
    },
  };
}

describe("release target identity", () => {
  it.each([stagingTarget, productionTarget])(
    "accepts matching $environment provider inventory without credentials in result",
    (target) => {
      expect(verifyReleaseTarget(target, inventoryFor(target))).toEqual({
        environment: target.environment,
        branchId: target.neonBranchId,
        role: target.role,
        database: target.database,
        host: new URL(target.directUrl).hostname,
      });
    },
  );

  it("rejects a production URL pointing at the staging endpoint", () => {
    expect(() =>
      verifyReleaseTarget(
        { ...productionTarget, directUrl: stagingTarget.directUrl },
        inventoryFor(productionTarget),
      ),
    ).toThrow();
  });

  it("rejects cross-branch endpoints and pooled URLs", () => {
    const inventory = inventoryFor(productionTarget);
    expect(() =>
      verifyReleaseTarget(productionTarget, {
        ...inventory,
        neonEndpoints: inventoryFor(stagingTarget).neonEndpoints,
      }),
    ).toThrow();
    expect(() =>
      verifyReleaseTarget(
        {
          ...productionTarget,
          directUrl: productionTarget.directUrl.replace(
            "ep-production.",
            "ep-production-pooler.",
          ),
        },
        inventory,
      ),
    ).toThrow();
  });

  it("rejects mismatched release/app roles, databases, Hyperdrive IDs, origins, and caching", () => {
    const inventory = inventoryFor(productionTarget);
    for (const target of [
      { ...productionTarget, role: "another_role" },
      { ...productionTarget, appRole: "another_app_role" },
      { ...productionTarget, appRole: productionTarget.role },
      { ...productionTarget, database: "another_database" },
      { ...productionTarget, hyperdriveId: stagingTarget.hyperdriveId },
    ]) {
      expect(() => verifyReleaseTarget(target, inventory)).toThrow();
    }
    expect(() =>
      verifyReleaseTarget(productionTarget, {
        ...inventory,
        hyperdrive: {
          ...inventory.hyperdrive,
          origin: {
            ...inventory.hyperdrive.origin,
            host: "ep-other.neon.tech",
          },
        },
      }),
    ).toThrow();
    expect(() =>
      verifyReleaseTarget(productionTarget, {
        ...inventory,
        hyperdrive: {
          ...inventory.hyperdrive,
          caching: { disabled: false },
        },
      }),
    ).toThrow();
  });

  it("loads only provider-verified metadata and never echoes API response secrets", async () => {
    const target = stagingTarget;
    const inventory = inventoryFor(target);
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.startsWith("https://console.neon.tech/api/v2/")) {
        expect(url).toContain(
          `/projects/${target.neonProjectId}/branches/${target.neonBranchId}/endpoints`,
        );
        return new Response(
          JSON.stringify({ endpoints: inventory.neonEndpoints }),
          {
            status: 200,
          },
        );
      }
      expect(url).toContain(
        `/accounts/${target.cloudflareAccountId}/hyperdrive/configs/${target.hyperdriveId}`,
      );
      return new Response(
        JSON.stringify({
          success: true,
          result: {
            ...inventory.hyperdrive,
            origin: {
              ...inventory.hyperdrive.origin,
              password: "provider-response-secret",
            },
          },
        }),
        { status: 200 },
      );
    });
    const loaded = await loadReleaseInventory(
      target,
      { neonApiKey: "neon-test-secret", cloudflareApiToken: "cf-test-secret" },
      fetcher,
    );
    expect(loaded).toEqual(inventory);
    expect(JSON.stringify(loaded)).not.toContain("secret");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails closed on provider API errors without leaking tokens or response bodies", async () => {
    const response = JSON.stringify({
      error: "neon-test-secret private-password",
    });
    const fetcher = vi.fn(async () => new Response(response, { status: 403 }));
    await expect(
      loadReleaseInventory(
        productionTarget,
        {
          neonApiKey: "neon-test-secret",
          cloudflareApiToken: "cf-test-secret",
        },
        fetcher,
      ),
    ).rejects.toThrow(/Neon inventory unavailable/);
    try {
      await loadReleaseInventory(
        productionTarget,
        {
          neonApiKey: "neon-test-secret",
          cloudflareApiToken: "cf-test-secret",
        },
        fetcher,
      );
    } catch (error) {
      expect(String(error)).not.toMatch(
        /neon-test-secret|cf-test-secret|private-password/,
      );
    }
  });
});
