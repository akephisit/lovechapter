import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: [
      "src/auth-postgres.integration.ts",
      "src/guest-affiliations-postgres.integration.ts",
      "src/guest-import-postgres.integration.ts",
      "src/envelope-postgres.integration.ts",
      "src/planning-postgres.integration.ts",
    ],
  },
});
