import type { NextConfig } from "next";
import path from "node:path";

// Pin Turbopack's workspace root to the chatbot/ directory itself.
// Without this, Turbopack walks up looking for the nearest lockfile and
// picks the parent hindsight/ project's package-lock.json, which causes
// the "module factory not available" runtime error on
// next/dist/compiled/react/jsx-dev-runtime.js when the inferred root
// disagrees with the actual install location.
//
// Refs: https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack#root-directory
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
};

export default nextConfig;
