import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.lhr.life", "*.localhost.run"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
