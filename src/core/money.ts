/**
 * Uang disimpan sebagai integer Rupiah utuh (ADR 005). Dilarang float.
 */

/** Nominal valid: integer aman (Number.isSafeInteger) dan tidak negatif. */
export function isValidAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Menjumlahkan integer dan melempar error bila hasil melewati batas
 * integer aman, alih-alih diam-diam kehilangan presisi.
 */
export function sumAmounts(values: readonly number[]): number {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`Nilai uang bukan integer aman: ${value}`);
    }
    total += value;
    if (!Number.isSafeInteger(total)) {
      throw new RangeError("Total nilai uang melewati batas integer aman");
    }
  }
  return total;
}

/** Format tampilan `Rp 1.234.567` (negatif: `-Rp 1.234.567`). */
export function formatRupiah(value: number): string {
  const formatted = `Rp ${Math.abs(value).toLocaleString("id-ID")}`;
  return value < 0 ? `-${formatted}` : formatted;
}
