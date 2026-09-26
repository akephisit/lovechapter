import { describe, expect, it } from "vitest";

import {
  requireSecretsFileArgument,
  validateStagingApiDryRuns,
} from "./staging-api-preflight.mjs";

const defaultOutput = `
env.HYPERDRIVE (production-hyperdrive-id) Hyperdrive Config
--dry-run: exiting now.
`;
const stagingOutput = `
env.HYPERDRIVE (staging-hyperdrive-id) Hyperdrive Config
--dry-run: exiting now.
`;

describe("staging API deploy preflight", () => {
  it("requires an explicit secrets file before any deploy command", () => {
    expect(() => requireSecretsFileArgument([])).toThrow("--secrets-file");
    expect(() => requireSecretsFileArgument([".env.staging"])).toThrow(
      "--secrets-file",
    );
    expect(requireSecretsFileArgument(["--secrets-file", ".env.staging"])).toBe(
      ".env.staging",
    );
  });

  it("accepts a separate configured staging Hyperdrive binding", () => {
    expect(() =>
      validateStagingApiDryRuns(stagingOutput, defaultOutput),
    ).not.toThrow();
  });

  it("rejects Wrangler's silent fallback when staging is undefined", () => {
    expect(() =>
      validateStagingApiDryRuns(
        `${stagingOutput}\nNo environment found in configuration with name "staging"`,
        defaultOutput,
      ),
    ).toThrow("staging environment is missing");
  });

  it("rejects an unresolved staging Hyperdrive placeholder", () => {
    expect(() =>
      validateStagingApiDryRuns(
        stagingOutput.replace(
          "staging-hyperdrive-id",
          "REPLACE_WITH_STAGING_HYPERDRIVE_ID",
        ),
        defaultOutput,
      ),
    ).toThrow("staging Hyperdrive ID is not configured");
  });

  it("rejects reuse of the default Hyperdrive configuration", () => {
    expect(() =>
      validateStagingApiDryRuns(
        stagingOutput.replace(
          "staging-hyperdrive-id",
          "production-hyperdrive-id",
        ),
        defaultOutput,
      ),
    ).toThrow("staging must not use the default Hyperdrive ID");
  });
});
