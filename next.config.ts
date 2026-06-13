import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Resolve the project root from this config file's own location so the value
// is invariant to the package-manager layout (npm-hoisted vs pnpm/.pnpm).
const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", "*.lhr.life", "*.localhost.run", "*.ngrok-free.dev"],
  // Native addon: keep it external so the server bundler does not try to pack
  // better-sqlite3's .node binary (which would fail at request time).
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
