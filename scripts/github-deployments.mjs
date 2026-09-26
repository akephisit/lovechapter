import { selectProductionBaseline } from "./deployment-ledger.mjs";

const baseUrl =
  "https://api.github.com/repos/akephisit/lovechapter/deployments";
const task = "lovechapter-worker-release";
const shaPattern = /^[0-9a-f]{40}$/u;
const states = new Set([
  "error",
  "failure",
  "inactive",
  "in_progress",
  "queued",
  "pending",
  "success",
]);

function validId(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function version(value) {
  if (
    typeof value?.versionId !== "string" ||
    !value.versionId ||
    !shaPattern.test(value.sourceSha ?? "")
  ) {
    throw new Error("invalid version");
  }
  return { versionId: value.versionId, sourceSha: value.sourceSha };
}

function projectDeployment(value) {
  if (
    !validId(value?.id) ||
    value.environment !== "production" ||
    value.task !== task ||
    !shaPattern.test(value.sha ?? "")
  ) {
    throw new Error("invalid deployment");
  }
  return {
    id: value.id,
    sha: value.sha,
    environment: "production",
    task,
    payload: {
      web: version(value.payload?.web),
      api: version(value.payload?.api),
    },
  };
}

/** Restrict all ledger traffic to the fixed repository; never follow provider URLs. */
export function createGitHubDeploymentClient({
  token,
  fetcher = globalThis.fetch,
}) {
  if (
    typeof token !== "string" ||
    !token.trim() ||
    typeof fetcher !== "function"
  ) {
    throw new Error("GitHub deployment credential is required");
  }
  async function request(url, method = "GET", body) {
    try {
      const response = await fetcher(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "manual",
        cache: "no-store",
        signal: globalThis.AbortSignal.timeout(10_000),
      });
      if (response.status !== (method === "GET" ? 200 : 201)) {
        throw new Error("provider status");
      }
      return {
        value: await response.json(),
        link: response.headers.get("link") ?? "",
      };
    } catch {
      throw new Error("GitHub deployment ledger unavailable");
    }
  }
  async function listPages(path, project) {
    const results = [];
    try {
      for (let page = 1; page <= 10; page += 1) {
        const separator = path.includes("?") ? "&" : "?";
        const { value, link } = await request(
          `${path}${separator}per_page=100&page=${page}`,
        );
        if (!Array.isArray(value) || value.length > 100) {
          throw new Error("provider list malformed");
        }
        results.push(...value.map(project));
        if (!/\brel="next"/u.test(link)) {
          return results.sort((left, right) => right.id - left.id);
        }
      }
      throw new Error("ledger exceeds bound");
    } catch {
      throw new Error("GitHub deployment ledger unavailable");
    }
  }
  function listProductionDeployments() {
    return listPages(
      `${baseUrl}?environment=production&task=${task}`,
      projectDeployment,
    );
  }
  function listDeploymentStatuses(deploymentId) {
    if (!validId(deploymentId)) {
      throw new Error("GitHub deployment ledger unavailable");
    }
    return listPages(`${baseUrl}/${deploymentId}/statuses`, (value) => {
      if (!validId(value?.id) || !states.has(value.state)) {
        throw new Error("invalid deployment status");
      }
      return {
        id: value.id,
        deployment_id: deploymentId,
        state: value.state,
      };
    });
  }
  return {
    listProductionDeployments,
    listDeploymentStatuses,
    async readProductionBaseline(gateStatus) {
      const deployments = await listProductionDeployments();
      if (deployments.length === 0) return null;
      const statuses = await listDeploymentStatuses(deployments[0].id);
      return selectProductionBaseline(deployments, statuses, gateStatus);
    },
    async createDeployment(input) {
      try {
        if (
          !shaPattern.test(input?.ref ?? "") ||
          input.environment !== "production" ||
          input.task !== task ||
          input.auto_merge !== false ||
          !Array.isArray(input.required_contexts) ||
          input.required_contexts.length !== 0
        ) {
          throw new Error("invalid deployment input");
        }
        const body = {
          ref: input.ref,
          environment: "production",
          task,
          payload: {
            web: version(input.payload?.web),
            api: version(input.payload?.api),
          },
          auto_merge: false,
          required_contexts: [],
        };
        const { value } = await request(baseUrl, "POST", body);
        if (
          !validId(value?.id) ||
          value.sha !== input.ref ||
          value.environment !== "production" ||
          value.task !== task
        ) {
          throw new Error("deployment receipt mismatch");
        }
        return { id: value.id };
      } catch {
        throw new Error("GitHub deployment ledger unavailable");
      }
    },
    async createDeploymentStatus(deploymentId, input) {
      try {
        if (
          !validId(deploymentId) ||
          input?.state !== "success" ||
          input.environment !== "production"
        ) {
          throw new Error("invalid deployment status input");
        }
        const { value } = await request(
          `${baseUrl}/${deploymentId}/statuses`,
          "POST",
          { state: "success", environment: "production", auto_inactive: false },
        );
        if (
          !validId(value?.id) ||
          value.state !== "success" ||
          value.environment !== "production"
        ) {
          throw new Error("deployment status receipt mismatch");
        }
        return { id: value.id };
      } catch {
        throw new Error("GitHub deployment ledger unavailable");
      }
    },
  };
}
