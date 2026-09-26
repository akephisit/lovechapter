import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const wrangler = resolve(root, "node_modules/wrangler/bin/wrangler.js");
function apiDryRun() {
  const result = spawnSync(
    "npm",
    ["run", "build:worker:staging", "--workspace", "@lovechapter/api"],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, NO_COLOR: "1" },
      timeout: 30_000,
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  return `${result.stdout}\n${result.stderr}`;
}

describe("staging Worker deployment", () => {
  it("uses a distinct staging Hyperdrive binding instead of silently falling back to the default Worker", () => {
    const output = apiDryRun();

    expect(output).not.toContain(
      'No environment found in configuration with name "staging"',
    );
    expect(output).toMatch(
      /env\.HYPERDRIVE \((?!REPLACE_WITH_HYPERDRIVE_ID)[^)]+\)/,
    );
  });

  it("defines a separate web staging environment for Wrangler", () => {
    const temporaryDirectory = mkdtempSync(
      resolve(tmpdir(), "lovechapter-web-types-"),
    );
    try {
      const result = spawnSync(
        process.execPath,
        [
          wrangler,
          "types",
          resolve(temporaryDirectory, "worker-configuration.d.ts"),
          "--env",
          "staging",
          "--include-runtime",
          "false",
        ],
        {
          cwd: resolve(root, "apps/web"),
          encoding: "utf8",
          env: { ...process.env, NO_COLOR: "1" },
          timeout: 30_000,
        },
      );

      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(`${result.stdout}\n${result.stderr}`).not.toContain(
        'No environment found in configuration with name "staging"',
      );
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
