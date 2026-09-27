import console from "node:console";
import process from "node:process";
import { pathToFileURL } from "node:url";

const accountIdPattern = /^[0-9a-f]{32}$/u;
const workerNames = ["lovechapter-api-staging", "lovechapter-web-staging"];
const failure = "Staging Cloudflare credential probe failed";

async function readJson(url, token, fetcher) {
  const response = await fetcher(url, {
    method: "GET",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    signal: globalThis.AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(failure);
  const body = await response.json();
  if (body?.success !== true) throw new Error(failure);
  return body.result;
}

/** Read only the Cloudflare resources needed for a staging Worker release. */
export async function probeStagingCloudflareCredential(
  env,
  { fetcher = globalThis.fetch } = {},
) {
  const accountId = env?.RELEASE_CLOUDFLARE_ACCOUNT_ID;
  const hyperdriveId = env?.RELEASE_HYPERDRIVE_ID;
  const token = env?.RELEASE_CLOUDFLARE_API_TOKEN;
  if (
    env?.GITHUB_ACTIONS !== "true" ||
    env.GITHUB_EVENT_NAME !== "workflow_dispatch" ||
    env.GITHUB_REF !== "refs/heads/main" ||
    env.GITHUB_REF_PROTECTED !== "true" ||
    env.GITHUB_REPOSITORY !== "akephisit/lovechapter" ||
    !accountIdPattern.test(accountId ?? "") ||
    !accountIdPattern.test(hyperdriveId ?? "") ||
    typeof token !== "string" ||
    !token.trim() ||
    token.startsWith("REPLACE_WITH_")
  ) {
    throw new Error(failure);
  }

  try {
    const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}`;
    const hyperdrive = await readJson(
      `${base}/hyperdrive/configs/${hyperdriveId}`,
      token,
      fetcher,
    );
    if (
      hyperdrive?.id !== hyperdriveId ||
      hyperdrive.caching?.disabled !== true
    ) {
      throw new Error(failure);
    }
    for (const name of workerNames) {
      const workerBase = `${base}/workers/scripts/${name}`;
      const deployment = await readJson(
        `${workerBase}/deployments`,
        token,
        fetcher,
      );
      if (
        !Array.isArray(deployment?.deployments) ||
        !deployment.deployments.some(
          (entry) =>
            Array.isArray(entry?.versions) &&
            entry.versions.some(
              (version) =>
                typeof version?.version_id === "string" &&
                version.version_id.length > 0 &&
                version.percentage === 100,
            ),
        )
      ) {
        throw new Error(failure);
      }
      const subdomain = await readJson(
        `${workerBase}/subdomain`,
        token,
        fetcher,
      );
      if (subdomain?.previews_enabled !== false) throw new Error(failure);
    }
    return { hyperdriveId, workerNames: [...workerNames] };
  } catch {
    throw new Error(failure);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await probeStagingCloudflareCredential(process.env);
    console.log("staging_cloudflare_credential_probe_ok");
  } catch {
    console.error("staging_cloudflare_credential_probe_failed");
    process.exitCode = 1;
  }
}
