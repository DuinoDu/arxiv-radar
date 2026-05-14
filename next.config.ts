import type { NextConfig } from "next";
import { dirname } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const projectRoot = dirname(dirname(dirname(require.resolve("next/package.json"))));

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "*.lhr.life", "*.localhost.run"],
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
