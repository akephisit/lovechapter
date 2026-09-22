import type { NextConfig } from "next";

import { parseClerkPublishableKey } from "./lib/clerk-config";

parseClerkPublishableKey(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
