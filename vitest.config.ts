import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    coverage: { enabled: false },
    include: ["{apps,packages}/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
    passWithNoTests: false,
    setupFiles: ["./apps/web/vitest.setup.ts"],
  },
});
