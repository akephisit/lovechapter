import { describe, expect, it, vi } from "vitest";

import { createGitHubDeploymentClient } from "./github-deployments.mjs";

const sha = "a".repeat(40);
const version = {
  web: { versionId: "web-v1", sourceSha: sha },
  api: { versionId: "api-v1", sourceSha: sha },
};
const deployment = {
  id: 47,
  sha,
  environment: "production",
  task: "lovechapter-worker-release",
  payload: { ...version, privateCredential: "must-not-return" },
  creator: { email: "must-not-return@example.test" },
};
const status = {
  id: 71,
  state: "success",
  environment: "production",
  creator: { email: "must-not-return@example.test" },
};

function response(value, statusCode = 200, headers = {}) {
  return globalThis.Response.json(value, {
    status: statusCode,
    headers,
  });
}

describe("GitHub deployment ledger client", () => {
  it("reads the exact production task and projects only release fields", async () => {
    const requests = [];
    const fetcher = vi.fn(async (url, options) => {
      requests.push({ url, options });
      if (url.includes("/deployments/47/statuses")) return response([status]);
      return response([deployment]);
    });
    const client = createGitHubDeploymentClient({
      token: "sensitive-token",
      fetcher,
    });
    const deployments = await client.listProductionDeployments();
    const statuses = await client.listDeploymentStatuses(47);
    expect(deployments).toEqual([
      {
        id: 47,
        sha,
        environment: "production",
        task: "lovechapter-worker-release",
        payload: version,
      },
    ]);
    expect(statuses).toEqual([{ id: 71, deployment_id: 47, state: "success" }]);
    expect(requests[0].url).toBe(
      "https://api.github.com/repos/akephisit/lovechapter/deployments?environment=production&task=lovechapter-worker-release&per_page=100&page=1",
    );
    expect(requests[1].url).toBe(
      "https://api.github.com/repos/akephisit/lovechapter/deployments/47/statuses?per_page=100&page=1",
    );
    expect(
      requests.every(
        ({ options }) =>
          options.headers.Authorization === "Bearer sensitive-token",
      ),
    ).toBe(true);
    expect(JSON.stringify({ deployments, statuses })).not.toContain(
      "must-not-return",
    );
  });

  it("paginates by a fixed API origin and refuses an unbounded ledger", async () => {
    const pageOne = Array.from({ length: 100 }, (_, index) => ({
      ...deployment,
      id: index + 1,
    }));
    const fetcher = vi.fn(async (url) => {
      if (new globalThis.URL(url).searchParams.get("page") === "1") {
        return response(pageOne, 200, {
          link: '<https://evil.example/steal>; rel="next"',
        });
      }
      return response([{ ...deployment, id: 101 }]);
    });
    const client = createGitHubDeploymentClient({
      token: "sensitive-token",
      fetcher,
    });
    const found = await client.listProductionDeployments();
    expect(found).toHaveLength(101);
    expect(found[0].id).toBe(101);
    expect(fetcher.mock.calls[1][0]).toBe(
      "https://api.github.com/repos/akephisit/lovechapter/deployments?environment=production&task=lovechapter-worker-release&per_page=100&page=2",
    );

    const neverEnds = createGitHubDeploymentClient({
      token: "sensitive-token",
      fetcher: async () =>
        response(pageOne, 200, {
          link: '<https://api.github.com/next>; rel="next"',
        }),
    });
    await expect(neverEnds.listProductionDeployments()).rejects.toThrow(
      "GitHub deployment ledger unavailable",
    );
  });

  it("creates only exact SHA/version evidence and verifies the receipt", async () => {
    const requests = [];
    const fetcher = vi.fn(async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("/statuses")) {
        return response(
          { id: 72, state: "success", environment: "production" },
          201,
        );
      }
      return response(
        {
          id: 47,
          sha,
          task: "lovechapter-worker-release",
          environment: "production",
        },
        201,
      );
    });
    const client = createGitHubDeploymentClient({
      token: "sensitive-token",
      fetcher,
    });
    await expect(
      client.createDeployment({
        ref: sha,
        environment: "production",
        task: "lovechapter-worker-release",
        payload: { ...version, privateCredential: "must-not-send" },
        auto_merge: false,
        required_contexts: [],
      }),
    ).resolves.toEqual({ id: 47 });
    await expect(
      client.createDeploymentStatus(47, {
        state: "success",
        environment: "production",
      }),
    ).resolves.toEqual({ id: 72 });
    expect(JSON.parse(requests[0].options.body)).toEqual({
      ref: sha,
      environment: "production",
      task: "lovechapter-worker-release",
      payload: version,
      auto_merge: false,
      required_contexts: [],
    });
    expect(JSON.parse(requests[1].options.body)).toEqual({
      state: "success",
      environment: "production",
      auto_inactive: false,
    });
    expect(
      JSON.stringify(requests.map(({ options }) => options.body)),
    ).not.toContain("must-not-send");
  });

  it("accepts a baseline only when the latest GitHub status and PostgreSQL gate agree", async () => {
    const fetcher = vi.fn(async (url) =>
      response(url.includes("/statuses") ? [status] : [deployment]),
    );
    const client = createGitHubDeploymentClient({
      token: "sensitive-token",
      fetcher,
    });
    const gate = {
      mode: "open",
      targetSha: sha,
      web: version.web,
      api: version.api,
    };
    await expect(client.readProductionBaseline(gate)).resolves.toEqual({
      sha,
      ...version,
    });
    await expect(
      client.readProductionBaseline({ ...gate, targetSha: "b".repeat(40) }),
    ).resolves.toBeNull();
    const failed = createGitHubDeploymentClient({
      token: "sensitive-token",
      fetcher: async (url) =>
        response(
          url.includes("/statuses")
            ? [{ ...status, state: "failure" }]
            : [deployment],
        ),
    });
    await expect(failed.readProductionBaseline(gate)).resolves.toBeNull();
  });

  it("fails closed and redacts provider failures or mismatched deployment receipts", async () => {
    for (const returned of [
      response({ message: "sensitive-token" }, 403),
      response([{ ...deployment, sha: "invalid" }]),
      response([{ ...deployment, environment: "staging" }]),
    ]) {
      const client = createGitHubDeploymentClient({
        token: "sensitive-token",
        fetcher: async () => returned,
      });
      await expect(client.listProductionDeployments()).rejects.toThrow(
        "GitHub deployment ledger unavailable",
      );
    }
    const client = createGitHubDeploymentClient({
      token: "sensitive-token",
      fetcher: async () =>
        response(
          {
            id: 47,
            sha: "b".repeat(40),
            task: deployment.task,
            environment: "production",
          },
          201,
        ),
    });
    await expect(
      client.createDeployment({
        ref: sha,
        environment: "production",
        task: deployment.task,
        payload: version,
        auto_merge: false,
        required_contexts: [],
      }),
    ).rejects.toThrow("GitHub deployment ledger unavailable");
  });
});
