import { describe, expect, it } from "vitest";
import { applyRemember, parseCookieHeader, rememberFromCookieHeader, serializeCookie } from "@/lib/supabase/session-cookies";

describe("Ingat perangkat ini (ADR 019)", () => {
  const persistent = { path: "/", sameSite: "lax", maxAge: 400 * 24 * 60 * 60 };

  it("diingat: opsi tidak berubah", () => {
    expect(applyRemember(persistent, true)).toEqual(persistent);
  });

  it("tidak diingat: maxAge/expires dibuang (cookie sesi), penghapusan tetap", () => {
    expect(applyRemember({ ...persistent, expires: new Date(Date.now() + 1e9) }, false)).toEqual({ path: "/", sameSite: "lax" });
    expect(applyRemember({ path: "/", maxAge: 0 }, false)).toEqual({ path: "/", maxAge: 0 });
    const past = new Date(0);
    expect(applyRemember({ path: "/", expires: past }, false)).toEqual({ path: "/", expires: past });
    expect(applyRemember(undefined, false)).toBeUndefined();
  });

  it("penanda pilihan dibaca dari header cookie", () => {
    expect(rememberFromCookieHeader("a=1; act-remember=0; b=2")).toBe(false);
    expect(rememberFromCookieHeader("a=1; act-remember=1")).toBe(true);
    expect(rememberFromCookieHeader("")).toBe(true);
  });

  it("serialisasi & parsing cookie bolak-balik", () => {
    const line = serializeCookie("sb-x-auth-token", "base64-eyJ{a b}", { path: "/", sameSite: "lax", maxAge: 60, secure: true });
    expect(line).toBe("sb-x-auth-token=base64-eyJ%7Ba%20b%7D; Path=/; Max-Age=60; SameSite=lax; Secure");
    expect(serializeCookie("x", "1", { path: "/", sameSite: "lax" })).toBe("x=1; Path=/; SameSite=lax");
    expect(parseCookieHeader("sb-x-auth-token=base64-eyJ%7Ba%20b%7D; act-remember=0")).toEqual([
      { name: "sb-x-auth-token", value: "base64-eyJ{a b}" },
      { name: "act-remember", value: "0" },
    ]);
  });
});
