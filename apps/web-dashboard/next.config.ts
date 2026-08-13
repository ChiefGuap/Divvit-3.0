import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Several lockfiles exist above this app (repo root + home dir); pin the
  // trace root so Next doesn't guess and warn on every start.
  outputFileTracingRoot: path.join(__dirname, "../../"),
};

export default nextConfig;
