"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAnonKey, supabaseUrl } from "./config";
import { applyRemember, parseCookieHeader, rememberFromCookieHeader, serializeCookie } from "./session-cookies";

let client: SupabaseClient | null = null;

/**
 * Klien Supabase browser. Sesi disimpan di cookie agar terbaca proxy; bila
 * "Ingat perangkat ini" tidak dicentang, cookie ditulis sebagai cookie sesi (ADR 019).
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  client ??= createBrowserClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll: () => parseCookieHeader(document.cookie),
      setAll: (cookies) => {
        const remember = rememberFromCookieHeader(document.cookie);
        for (const { name, value, options } of cookies) {
          document.cookie = serializeCookie(name, value, applyRemember(options, remember));
        }
      },
    },
  });
  return client;
}
