const mainRefUrl =
  "https://api.github.com/repos/akephisit/lovechapter/git/ref/heads/main";
const shaPattern = /^[0-9a-f]{40}$/u;

/** Read the live source ref; no response body or credential reaches release logs. */
export function createGitHubReadClient({ token, fetcher = globalThis.fetch }) {
  if (!token || !token.trim() || typeof fetcher !== "function") {
    throw new Error("GitHub release read credential is required");
  }
  return {
    async readMainHead() {
      try {
        const response = await fetcher(mainRefUrl, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          signal: globalThis.AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error("provider response unavailable");
        const body = await response.json();
        if (
          body?.ref !== "refs/heads/main" ||
          body.object?.type !== "commit" ||
          !shaPattern.test(body.object.sha ?? "")
        ) {
          throw new Error("provider response malformed");
        }
        return body.object.sha;
      } catch {
        throw new Error("GitHub main ref unavailable");
      }
    },
  };
}
