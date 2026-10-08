import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const { version } = JSON.parse(readFileSync(path.join(process.cwd(), "package.json"), "utf8")) as { version: string };

const nextConfig: NextConfig = {
  // Versi aplikasi untuk footer (bukan rahasia).
  env: { NEXT_PUBLIC_APP_VERSION: version },
  // Header keamanan umum & service worker PWA (ROADMAP Fase 9, panduan PWA Next.js).
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
