import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import vinext from "vinext";

import { parseClerkPublishableKey } from "./lib/clerk-config.ts";
import { parsePublicApiOrigin } from "./lib/public-origin.ts";

const clerkPublishableKey = parseClerkPublishableKey(
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);
const publicApiOrigin = parsePublicApiOrigin(
  process.env.NEXT_PUBLIC_API_ORIGIN,
);

export default defineConfig({
  define: {
    "process.env.NEXT_PUBLIC_API_ORIGIN": JSON.stringify(publicApiOrigin),
    "process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY":
      JSON.stringify(clerkPublishableKey),
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
