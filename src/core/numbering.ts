import { yearOf } from "./dates";
import type { IsoDate } from "./types";

const ENTRY_NUMBER = /^JU-(\d{4})-(\d+)$/;

/** Format nomor jurnal posted: `JU-<tahun buku>-<urut 4 digit>` (ADR 008). */
export function formatEntryNumber(year: number, sequence: number): string {
  return `JU-${year}-${String(sequence).padStart(4, "0")}`;
}

/**
 * Nomor berikutnya untuk tahun buku tanggal jurnal, berdasarkan nomor
 * yang sudah dipakai di workspace tersebut.
 */
export function nextEntryNumber(
  existingNumbers: readonly (string | null)[],
  entryDate: IsoDate,
): string {
  const year = yearOf(entryDate);
  let max = 0;
  for (const value of existingNumbers) {
    const match = value ? ENTRY_NUMBER.exec(value) : null;
    if (match && Number(match[1]) === year) {
      max = Math.max(max, Number(match[2]));
    }
  }
  return formatEntryNumber(year, max + 1);
}
