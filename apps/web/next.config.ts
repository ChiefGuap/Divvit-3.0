import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Several lockfiles exist above this app (repo root + home dir); pin the
  // trace root so Next doesn't guess.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  images: { remotePatterns: [{ protocol: "https", hostname: "**" }] },
};

export default nextConfig;
