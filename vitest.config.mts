import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Test Supabase dijalankan terpisah: pnpm test:supabase (vitest.supabase.config.mts).
    exclude: ["**/node_modules/**", "src/**/*.supabase.test.ts"],
  },
});
