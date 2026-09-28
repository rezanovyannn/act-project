/**
 * Format tampilan & parsing input untuk UI berbahasa Indonesia.
 * Uang tetap integer Rupiah (ADR 005); tanggal `YYYY-MM-DD` ditampilkan lokal.
 */
import { isValidIsoDate, toIsoDate } from "./dates";
import type { IsoDate } from "./types";

/** Konvensi laporan akuntansi: negatif dalam kurung, mis. `(Rp 1.250.000)`. */
export function formatAccounting(value: number): string {
  const formatted = `Rp ${Math.abs(value).toLocaleString("id-ID")}`;
  return value < 0 ? `(${formatted})` : formatted;
}

/** Angka tanpa prefix Rp, mis. `1.250.000`; untuk isi input nominal. */
export function formatNumber(value: number): string {
  return value.toLocaleString("id-ID");
}

/**
 * Mengubah teks input nominal (mis. `Rp 1.250.000`, `1250000`) menjadi
 * integer Rupiah. Kosong = 0. Mengembalikan `null` bila tidak valid
 * (huruf, desimal, negatif, atau melewati batas integer aman).
 */
export function parseRupiahInput(text: string): number | null {
  const cleaned = text.replace(/rp/i, "").replace(/[\s.]/g, "");
  if (cleaned === "") return 0;
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : null;
}

function toUtcDate(date: IsoDate): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** `2026-09-28` → `28 Sep 2026`. */
export function formatDate(date: IsoDate): string {
  if (!isValidIsoDate(date)) return date;
  return new Intl.DateTimeFormat("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(toUtcDate(date));
}

/** `2026-09-28` → `September 2026`. */
export function formatMonth(date: IsoDate): string {
  if (!isValidIsoDate(date)) return date;
  return new Intl.DateTimeFormat("id-ID", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(toUtcDate(date));
}

/** Tanggal hari ini menurut zona waktu perangkat pengguna. */
export function todayIsoDate(now: Date = new Date()): IsoDate {
  return toIsoDate(now.getFullYear(), now.getMonth() + 1, now.getDate());
}
