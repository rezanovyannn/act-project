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
