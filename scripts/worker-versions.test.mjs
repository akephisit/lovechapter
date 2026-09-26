import { describe, expect, it, vi } from "vitest";

import {
  assertClientBundleClean,
  createWorkerCommandRunner,
  deployPreparedVersions,
  prepareWorkerVersions,
  validateWorkerConfigs,
} from "./worker-versions.mjs";

const sha = "a".repeat(40);
const oldSha = "b".repeat(40);
const previous = {
  web: { versionId: "web-old", sourceSha: oldSha },
  api: { versionId: "api-old", sourceSha: oldSha },
};
const config = {
  api: {
    name: "lovechapter-api",
    keep_vars: true,
    preview_urls: false,
    hyperdrive: [{ binding: "HYPERDRIVE", id: "production-hd" }],
    env: {
      staging: {
        workers_dev: true,
        preview_urls: false,
        hyperdrive: [{ binding: "HYPERDRIVE", id: "staging-hd" }],
      },
    },
  },
  web: {
    name: "lovechapter-web",
    keep_vars: true,
    preview_urls: false,
    env: { staging: { workers_dev: true, preview_urls: false } },
  },
};

function runner(overrides = {}) {
  const calls = [];
  const active = { web: "web-old", api: "api-old" };
  const workerName = (component) => `lovechapter-${component}-staging`;
  const implementation = {
    validateTarget: vi.fn(async () => {
      calls.push("validate-target");
      return { web: workerName("web"), api: workerName("api") };
    }),
    readDeployment: vi.fn(async (component) => {
      calls.push(`read-${component}`);
      return {
        workerName: workerName(component),
        versions: [{ version_id: active[component], percentage: 100 }],
      };
    }),
    readPreviewSettings: vi.fn(async () => ({ previewsEnabled: false })),
    buildWeb: vi.fn(async () => calls.push("build-web")),
    dryRunWeb: vi.fn(async () => calls.push("dry-run-web")),
    scanWebClientBundle: vi.fn(async () => calls.push("scan-web")),
    buildApi: vi.fn(async () => calls.push("build-api")),
    dryRunApi: vi.fn(async () => calls.push("dry-run-api")),
    uploadApi: vi.fn(async () => {
      calls.push("upload-api");
      return "api-new";
    }),
    promoteWeb: vi.fn(async () => {
      calls.push("promote-web");
      active.web = "web-new";
    }),
    promoteApi: vi.fn(async () => {
      calls.push("promote-api");
      active.api = "api-new";
    }),
    ...overrides,
  };
  return { ...implementation, calls, active };
}

function input(impact) {
  return {
    environment: "staging",
    impact,
    sha,
    previous,
    hyperdriveId: "staging-hd",
  };
}

describe("selected Worker versions", () => {
  it("recognizes the checked-in staging targets with Version URLs disabled", async () => {
    const commands = createWorkerCommandRunner({
      cloudflareAccountId: "test-account",
      cloudflareApiToken: "test-token",
    });
    await expect(
      commands.validateTarget("staging", "e55ad44368d04224aa7ba4af95173e23"),
    ).resolves.toEqual({
      web: "lovechapter-web-staging",
      api: "lovechapter-api-staging",
    });
  });

  it("reads canonical Cloudflare deployment and Version URL state", async () => {
    const fetcher = vi.fn(async (url) => {
      if (url.endsWith("/subdomain")) {
        return new globalThis.Response(
          JSON.stringify({
            success: true,
            result: { previews_enabled: false },
          }),
          { status: 200 },
        );
      }
      return new globalThis.Response(
        JSON.stringify({
          success: true,
          result: {
            deployments: [
              {
                created_on: "2026-09-26T12:00:00Z",
                versions: [{ version_id: "web-new", percentage: 100 }],
              },
            ],
          },
        }),
        { status: 200 },
      );
    });
    const commands = createWorkerCommandRunner({
      cloudflareAccountId: "test-account",
      cloudflareApiToken: "test-token",
      fetcher,
    });
    await expect(
      commands.readPreviewSettings("web", "staging"),
    ).resolves.toEqual({
      previewsEnabled: false,
    });
    await expect(commands.readDeployment("web", "staging")).resolves.toEqual({
      workerName: "lovechapter-web-staging",
      versions: [{ version_id: "web-new", percentage: 100 }],
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("builds and deploys only web for a web-only change", async () => {
    const commands = runner();
    const prepared = await prepareWorkerVersions(
      input({ web: true, backend: false }),
      commands,
    );
    expect(prepared.webBuilt).toBe(true);
    expect(prepared.apiUploadedVersionId).toBeUndefined();
    expect(commands.calls).toContain("build-web");
    expect(commands.calls).not.toContain("build-api");
    expect(commands.calls).not.toContain("upload-api");
    const versions = await deployPreparedVersions(prepared, commands);
    expect(versions).toEqual({
      web: { versionId: "web-new", sourceSha: sha },
      api: previous.api,
    });
    expect(commands.calls).toContain("promote-web");
    expect(commands.calls).not.toContain("promote-api");
  });

  it("uploads API before closure and promotes only API after preparation", async () => {
    const commands = runner();
    const prepared = await prepareWorkerVersions(
      input({ web: false, backend: true }),
      commands,
    );
    expect(prepared.webBuilt).toBe(false);
    expect(commands.calls).not.toContain("build-web");
    expect(commands.calls.indexOf("build-api")).toBeLessThan(
      commands.calls.indexOf("upload-api"),
    );
    const versions = await deployPreparedVersions(prepared, commands);
    expect(versions).toEqual({
      web: previous.web,
      api: { versionId: "api-new", sourceSha: sha },
    });
    expect(commands.calls).not.toContain("promote-web");
  });

  it("finishes both builds and API upload before switching either Worker", async () => {
    const commands = runner();
    const prepared = await prepareWorkerVersions(
      input({ web: true, backend: true }),
      commands,
    );
    expect(commands.calls).not.toContain("promote-web");
    expect(commands.calls).not.toContain("promote-api");
    await deployPreparedVersions(prepared, commands);
    for (const build of ["build-web", "build-api", "upload-api"]) {
      expect(commands.calls.indexOf(build)).toBeLessThan(
        commands.calls.indexOf("promote-web"),
      );
    }
  });

  it("rejects missing staging config, wrong Hyperdrive, and placeholder production ID", () => {
    expect(() =>
      validateWorkerConfigs(
        "staging",
        { ...config.api, env: {} },
        config.web,
        "staging-hd",
      ),
    ).toThrow();
    expect(() =>
      validateWorkerConfigs("staging", config.api, config.web, "other-hd"),
    ).toThrow();
    expect(() =>
      validateWorkerConfigs(
        "production",
        {
          ...config.api,
          hyperdrive: [
            { binding: "HYPERDRIVE", id: "REPLACE_WITH_HYPERDRIVE_ID" },
          ],
        },
        config.web,
        "REPLACE_WITH_HYPERDRIVE_ID",
      ),
    ).toThrow();
    expect(() =>
      validateWorkerConfigs("preview", config.api, config.web, "staging-hd"),
    ).toThrow();
    expect(() =>
      validateWorkerConfigs(
        "staging",
        {
          ...config.api,
          env: { staging: { ...config.api.env.staging, preview_urls: true } },
        },
        config.web,
        "staging-hd",
      ),
    ).toThrow();
  });

  it("rejects a secret sentinel in the web client bundle", () => {
    expect(() =>
      assertClientBundleClean(
        [
          {
            path: "dist/client/assets/app.js",
            contents: "const x='secret-sentinel'",
          },
        ],
        ["secret-sentinel"],
      ),
    ).toThrow();
    expect(() =>
      assertClientBundleClean(
        [{ path: "dist/client/assets/app.js", contents: "safe client code" }],
        ["secret-sentinel"],
      ),
    ).not.toThrow();
  });

  it("rejects a 90/10 split or wrong Worker name on readback", async () => {
    const commands = runner();
    const prepared = await prepareWorkerVersions(
      input({ web: false, backend: true }),
      commands,
    );
    commands.readDeployment.mockImplementation(async (component) => ({
      workerName: `lovechapter-${component}-staging`,
      versions: [
        { version_id: "api-new", percentage: 90 },
        { version_id: "api-old", percentage: 10 },
      ],
    }));
    await expect(deployPreparedVersions(prepared, commands)).rejects.toThrow();
    const wrongName = runner({
      readDeployment: vi.fn(async (component) => ({
        workerName: `wrong-${component}`,
        versions: [
          { version_id: previous[component].versionId, percentage: 100 },
        ],
      })),
    });
    await expect(
      prepareWorkerVersions(input({ web: true, backend: false }), wrongName),
    ).rejects.toThrow();
  });

  it("refuses pre-closure upload while a Worker Version URL is public", async () => {
    const commands = runner({
      readPreviewSettings: vi.fn(async (component) => ({
        previewsEnabled: component === "api",
      })),
    });
    await expect(
      prepareWorkerVersions(input({ web: false, backend: true }), commands),
    ).rejects.toThrow();
    expect(commands.calls).not.toContain("upload-api");
  });
});
