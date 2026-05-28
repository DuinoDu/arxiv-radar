import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the project root from this config file's own location so the value
// is invariant to the package-manager layout (npm-hoisted vs pnpm/.pnpm).
const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "*.lhr.life", "*.localhost.run", "*.ngrok-free.dev"],
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
