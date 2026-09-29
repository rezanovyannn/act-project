/**
 * Test terhadap proyek Supabase dev (ADR 013): `pnpm test:supabase`.
 * Butuh internet dan NEXT_PUBLIC_SUPABASE_URL/ANON_KEY di .env.local.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((line) => /^[A-Z0-9_]+=/.test(line))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1).trim()];
      }),
  );
}

const env = readEnvFile(fileURLToPath(new URL("./.env.local", import.meta.url)));

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.supabase.test.ts"],
    env: {
      NEXT_PUBLIC_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
    },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Satu file per waktu: membatasi jumlah pendaftaran akun uji (rate limit Auth).
    fileParallelism: false,
  },
});
