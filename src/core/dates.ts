import type { IsoDate } from "./types";

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `true` bila `value` berformat `YYYY-MM-DD` dan merupakan tanggal kalender nyata. */
export function isValidIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

/** Jumlah hari pada bulan (month 1-12). */
export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function yearOf(date: IsoDate): number {
  return Number(date.slice(0, 4));
}

export function toIsoDate(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Hari terakhir pada bulan tanggal tersebut. */
export function endOfMonth(date: IsoDate): IsoDate {
  const year = yearOf(date);
  const month = Number(date.slice(5, 7));
  return toIsoDate(year, month, daysInMonth(year, month));
}
