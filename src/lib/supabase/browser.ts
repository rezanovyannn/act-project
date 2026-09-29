"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseUrl } from "./config";

let client: SupabaseClient | null = null;

/** Klien Supabase browser (sesi disimpan di cookie agar terbaca proxy). */
export function getSupabaseBrowserClient(): SupabaseClient {
  client ??= createBrowserClient(supabaseUrl, supabaseAnonKey);
  return client;
}
