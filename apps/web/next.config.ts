import type { NextConfig } from "next";

import { parseClerkPublishableKey } from "./lib/clerk-config";
import { parsePublicApiOrigin } from "./lib/public-origin";

parseClerkPublishableKey(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
parsePublicApiOrigin(process.env.NEXT_PUBLIC_API_ORIGIN);

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
