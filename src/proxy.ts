/**
 * Proxy Next.js 16 (pengganti middleware): memperbarui sesi Supabase di cookie
 * dan mengarahkan pengguna yang belum login ke /login (ADR 013).
 */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { dataSource, supabaseAnonKey, supabaseUrl } from "@/lib/supabase/config";
import { applyRemember, REMEMBER_COOKIE } from "@/lib/supabase/session-cookies";

const PUBLIC_PATHS = ["/login", "/register", "/forgot-password", "/reset-password"];
/** Halaman publik yang tetap boleh dibuka saat sudah login (sesi pemulihan kata sandi, ADR 019). */
const PUBLIC_WHEN_SIGNED_IN = ["/reset-password"];

export async function proxy(request: NextRequest) {
  if (dataSource() === "mock") return NextResponse.next();

  let response = NextResponse.next({ request });
  // "Ingat perangkat ini" tidak dicentang: cookie sesi yang diperbarui proxy juga tanpa umur (ADR 019).
  const remember = request.cookies.get(REMEMBER_COOKIE)?.value !== "0";
  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, applyRemember(options, remember)),
        );
        Object.entries(headers).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // getClaims() memverifikasi JWT; jangan menaruh kode lain di antara pembuatan klien dan panggilan ini.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  if (!signedIn && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  if (signedIn && isPublic && !PUBLIC_WHEN_SIGNED_IN.some((path) => pathname === path)) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|offline\\.html|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
