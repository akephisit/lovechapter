import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import vinext from "vinext";

import { parsePublicApiOrigin } from "./lib/public-origin.ts";

const publicApiOrigin = parsePublicApiOrigin(
  process.env.NEXT_PUBLIC_API_ORIGIN,
);

export default defineConfig({
  define: {
    "process.env.NEXT_PUBLIC_API_ORIGIN": JSON.stringify(publicApiOrigin),
  },
  plugins: [
    tailwindcss(),
    vinext(),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
});
