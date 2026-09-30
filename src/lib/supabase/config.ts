/**
 * Sumber data aplikasi (ADR 013). Default: Supabase bila URL & anon key diisi;
 * `NEXT_PUBLIC_DATA_SOURCE=mock` memaksa data contoh Fase 1 (localStorage).
 */
export type DataSource = "mock" | "supabase";

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function dataSource(): DataSource {
  if (process.env.NEXT_PUBLIC_DATA_SOURCE === "mock") return "mock";
  return supabaseUrl && supabaseAnonKey ? "supabase" : "mock";
}

/**
 * Build production tanpa URL & anon key Supabase adalah salah konfigurasi:
 * jangan diam-diam memakai data contoh di browser (ADR 018). Data contoh di
 * production hanya bila `NEXT_PUBLIC_DATA_SOURCE=mock` diisi dengan sengaja.
 */
export function configurationError(): string | null {
  if (process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_DATA_SOURCE === "mock") return null;
  if (supabaseUrl && supabaseAnonKey) return null;
  return "NEXT_PUBLIC_SUPABASE_URL dan NEXT_PUBLIC_SUPABASE_ANON_KEY belum diatur untuk deployment ini.";
}

/** Halaman Daftar tersedia kecuali `NEXT_PUBLIC_ALLOW_SIGNUP=false` (ADR 018). */
export const signupAllowed = process.env.NEXT_PUBLIC_ALLOW_SIGNUP !== "false";
