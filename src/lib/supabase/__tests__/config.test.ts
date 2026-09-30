import { afterEach, describe, expect, it, vi } from "vitest";

/** Memuat ulang modul konfigurasi dengan environment tertentu (nilai dibaca saat modul dimuat). */
async function loadConfig(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value as string);
  return import("@/lib/supabase/config");
}

describe("konfigurasi sumber data (ADR 018)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("production tanpa kunci Supabase = salah konfigurasi, bukan diam-diam data contoh", async () => {
    const config = await loadConfig({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", NEXT_PUBLIC_DATA_SOURCE: "" });
    expect(config.configurationError()).toMatch(/belum diatur/);
  });

  it("production dengan kunci Supabase atau data contoh yang disengaja: tidak ada error", async () => {
    expect((await loadConfig({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" })).configurationError()).toBeNull();
    const mock = await loadConfig({ NODE_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", NEXT_PUBLIC_DATA_SOURCE: "mock" });
    expect(mock.configurationError()).toBeNull();
    expect(mock.dataSource()).toBe("mock");
  });

  it("pengembangan tanpa kunci tetap boleh memakai data contoh", async () => {
    const config = await loadConfig({ NODE_ENV: "development", NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", NEXT_PUBLIC_DATA_SOURCE: "" });
    expect(config.configurationError()).toBeNull();
    expect(config.dataSource()).toBe("mock");
  });

  it("pendaftaran hanya ditutup bila NEXT_PUBLIC_ALLOW_SIGNUP=false", async () => {
    expect((await loadConfig({ NEXT_PUBLIC_ALLOW_SIGNUP: "false" })).signupAllowed).toBe(false);
    expect((await loadConfig({ NEXT_PUBLIC_ALLOW_SIGNUP: "" })).signupAllowed).toBe(true);
  });
});
