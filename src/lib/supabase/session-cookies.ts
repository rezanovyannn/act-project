/**
 * "Ingat perangkat ini" (ADR 019). @supabase/ssr selalu menulis cookie sesi
 * dengan umur 400 hari; bila pengguna tidak mencentang, cookie ditulis tanpa
 * umur (cookie sesi browser) sehingga terhapus saat browser ditutup.
 * Pilihan disimpan di cookie penanda `act-remember=0` (juga cookie sesi).
 */
export const REMEMBER_COOKIE = "act-remember";

export interface CookieOptionsLike {
  maxAge?: number;
  expires?: Date;
  [key: string]: unknown;
}

/** Opsi cookie sesuai pilihan: tanpa maxAge/expires bila tidak diingat; penghapusan (maxAge ≤ 0) tetap apa adanya. */
export function applyRemember<T extends CookieOptionsLike>(options: T | undefined, remember: boolean): T | undefined {
  if (!options || remember) return options;
  if (options.maxAge !== undefined && options.maxAge <= 0) return options;
  if (options.expires instanceof Date && options.expires.getTime() <= Date.now()) return options;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { maxAge, expires, ...rest } = options;
  return rest as T;
}

/** `false` bila string cookie memuat penanda `act-remember=0`. */
export function rememberFromCookieHeader(cookieHeader: string): boolean {
  return !cookieHeader.split(";").some((part) => part.trim() === `${REMEMBER_COOKIE}=0`);
}

/** Pasangan nama–nilai dari `document.cookie`. */
export function parseCookieHeader(cookieHeader: string): { name: string; value: string }[] {
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf("=");
      const name = index < 0 ? part : part.slice(0, index);
      const raw = index < 0 ? "" : part.slice(index + 1);
      let value = raw;
      try {
        value = decodeURIComponent(raw);
      } catch {
        // nilai tidak ter-encode: pakai apa adanya
      }
      return { name, value };
    });
}

/** Satu baris `document.cookie` dari nama, nilai, dan opsi gaya @supabase/ssr. */
export function serializeCookie(name: string, value: string, options: CookieOptionsLike = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${(options.path as string | undefined) ?? "/"}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${Math.floor(options.maxAge)}`);
  if (options.expires instanceof Date) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.domain) parts.push(`Domain=${options.domain as string}`);
  const sameSite = options.sameSite;
  if (sameSite) parts.push(`SameSite=${sameSite === true ? "Strict" : String(sameSite)}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}
