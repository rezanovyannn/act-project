import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const { version } = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version: string };

const nextConfig: NextConfig = {
  // Versi aplikasi untuk footer (bukan rahasia).
  env: { NEXT_PUBLIC_APP_VERSION: version },
};

export default nextConfig;
