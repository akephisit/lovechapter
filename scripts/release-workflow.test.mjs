import { readFileSync } from "node:fs";
import { URL } from "node:url";

import { describe, expect, it } from "vitest";

const workflowPath = new URL(
  "../.github/workflows/release.yml",
  import.meta.url,
);
const ownersPath = new URL("../.github/CODEOWNERS", import.meta.url);

describe("automatic Worker release workflow policy", () => {
  it("uses only an exact push-to-main SHA and serial non-canceling releases", () => {
    const source = readFileSync(workflowPath, "utf8");
    expect(source).toMatch(/on:\s*\n\s*push:\s*\n\s*branches:\s*\[main\]/u);
    expect(source).not.toMatch(
      /pull_request_target|workflow_run|workflow_dispatch/u,
    );
    expect(source).toMatch(/group:\s*lovechapter-worker-release/u);
    expect(source).toMatch(/cancel-in-progress:\s*false/u);
    expect(source).toMatch(/queue:\s*max/u);
    expect(source.match(/ref:\s*\$\{\{ github\.sha \}\}/gu)).toHaveLength(4);
    expect(source).toMatch(/github\.ref == 'refs\/heads\/main'/u);
    expect(source).toMatch(/vars\.STAGING_RELEASE_ENABLED == 'true'/u);
  });

  it("runs exact-SHA CI and PostgreSQL before staging, then gates production", () => {
    const source = readFileSync(workflowPath, "utf8");
    expect(source).toMatch(/ci:\s*\n[\s\S]*?run:\s*npm run ci/u);
    expect(source).toMatch(
      /postgres:\s*\n[\s\S]*?test:postgres --workspace @lovechapter\/database/u,
    );
    expect(source).toMatch(/staging:\s*\n\s*needs:\s*\[ci, postgres\]/u);
    expect(source).toMatch(/production:\s*\n\s*needs:\s*\[staging\]/u);
    expect(source).toMatch(/vars\.PRODUCTION_RELEASE_ENABLED == 'true'/u);
    expect(source).toMatch(/environment:\s*staging/u);
    expect(source).toMatch(/environment:\s*production/u);
    expect(source).toMatch(/node scripts\/release-cli\.mjs staging/u);
    expect(source).toMatch(/node scripts\/release-cli\.mjs production/u);
  });

  it("does not deploy outside the guarded CLI or expose release secrets to PRs", () => {
    const source = readFileSync(workflowPath, "utf8");
    expect(source).not.toMatch(/\bwrangler\s+(?:deploy|versions deploy)\b/u);
    expect(source).not.toMatch(/pull_request:/u);
    expect(source).toMatch(/permissions:\s*\n\s*contents:\s*read/u);
    expect(source).toMatch(/deployments:\s*write/u);
    expect(source).toMatch(/secrets\.RELEASE_DATABASE_URL/u);
    expect(source).toMatch(/secrets\.RELEASE_NEON_API_KEY/u);
    expect(source).toMatch(/secrets\.RELEASE_CLOUDFLARE_API_TOKEN/u);
  });

  it("passes environment-scoped target identities and keeps credentials in secrets", () => {
    const source = readFileSync(workflowPath, "utf8");
    for (const name of [
      "RELEASE_NEON_PROJECT_ID",
      "RELEASE_NEON_BRANCH_ID",
      "RELEASE_DATABASE_NAME",
      "RELEASE_DATABASE_ROLE",
      "RELEASE_APP_DATABASE_ROLE",
      "RELEASE_MIGRATION_DATABASE_ROLE",
      "RELEASE_CLOUDFLARE_ACCOUNT_ID",
      "RELEASE_HYPERDRIVE_ID",
      "RELEASE_WEB_ORIGIN",
      "RELEASE_API_ORIGIN",
    ]) {
      const setting = `${name}: ` + "${{ vars." + name + " }}";
      expect(source.split(setting)).toHaveLength(3);
    }
    for (const name of [
      "RELEASE_DATABASE_URL",
      "RELEASE_MIGRATION_DATABASE_URL",
      "RELEASE_NEON_API_KEY",
      "RELEASE_CLOUDFLARE_API_TOKEN",
      "WEB_PROXY_SHARED_SECRET",
      "RELEASE_PROBE_SECRET",
    ]) {
      const setting = `${name}: ` + "${{ secrets." + name + " }}";
      expect(source.split(setting)).toHaveLength(3);
    }
    expect(source).toMatch(
      /RELEASE_POSTGRES_JOB_RESULT: \$\{\{ needs\.postgres\.result \}\}/u,
    );
    expect(source).toMatch(
      /RELEASE_TEST_DATABASE_URL: \$\{\{ secrets\.RELEASE_TEST_DATABASE_URL \}\}/u,
    );
    expect(source).toMatch(
      /RELEASE_TEST_PASSWORD: \$\{\{ secrets\.RELEASE_TEST_PASSWORD \}\}/u,
    );
    expect(source).toMatch(
      /RELEASE_TEST_BRANCH_ID: \$\{\{ vars\.RELEASE_TEST_BRANCH_ID \}\}/u,
    );
    expect(source).toMatch(
      /acceptance: \$\{\{ steps\.release\.outputs\.acceptance \}\}/u,
    );
    expect(source).toMatch(
      /RELEASE_STAGING_ACCEPTANCE: \$\{\{ needs\.staging\.outputs\.acceptance \}\}/u,
    );
  });

  it("requests ownership review for release, migration, and security changes", () => {
    const owners = readFileSync(ownersPath, "utf8");
    for (const path of [
      "/.github/workflows/release.yml",
      "/scripts/release-*.mjs",
      "/packages/database/drizzle/*.sql",
      "/packages/auth/",
    ]) {
      expect(owners).toContain(path);
    }
  });
});
