import type { NextConfig } from "next";

import { parsePublicApiOrigin } from "./lib/public-origin";

parsePublicApiOrigin(process.env.NEXT_PUBLIC_API_ORIGIN);

const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
