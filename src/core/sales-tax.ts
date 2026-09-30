/**
 * Pajak penjualan (PB1/PPN sederhana) dengan aritmetika integer (ADR 005 & 012).
 * Tarif dalam basis poin: 1000 = 10%. Pembulatan ke Rupiah terdekat,
 * setengah ke atas, sekali per transaksi.
 */
import { fail } from "./errors";

export interface SalesTaxSettings {
  rateBps: number;
  inclusive: boolean;
}

/** Nama pajak penjualan yang tampil di UI & akun (ADR 015). Mekanismenya sama. */
export type SalesTaxLabel = "PB1" | "PPN";
export const SALES_TAX_LABELS: readonly SalesTaxLabel[] = ["PB1", "PPN"];

/** Pengaturan pajak penjualan per workspace. */
export interface WorkspaceTaxSettings extends SalesTaxSettings {
  label: SalesTaxLabel;
}

export interface SalesTaxResult {
  /** Dasar pengenaan (pendapatan). */
  base: number;
  tax: number;
  /** Yang dibayar konsumen. */
  total: number;
}

export const MAX_TAX_RATE_BPS = 10_000;

// Konstanta BigInt tanpa literal `n` (target tsconfig ES2017).
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
const BPS = BigInt(10_000);

export function isValidTaxRate(rateBps: unknown): rateBps is number {
  return (
    typeof rateBps === "number" &&
    Number.isSafeInteger(rateBps) &&
    rateBps >= 0 &&
    rateBps <= MAX_TAX_RATE_BPS
  );
}

/** round(numerator / denominator), setengah ke atas, untuk bilangan non-negatif. */
function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * TWO + denominator) / (denominator * TWO);
}

function toSafeNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) {
    fail("AMOUNT_OVERFLOW", "Nominal melewati batas yang didukung");
  }
  return result;
}

/**
 * Menghitung PB1 dari `amount`:
 * - harga belum termasuk PB1: `amount` = dasar, pajak ditambahkan;
 * - harga sudah termasuk PB1: `amount` = total, dasar dihitung mundur.
 */
export function computeSalesTax(amount: number, settings: SalesTaxSettings): SalesTaxResult {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    fail("INVALID_AMOUNT", "Nominal harus bilangan bulat Rupiah tidak negatif");
  }
  if (!isValidTaxRate(settings.rateBps)) {
    fail("INVALID_AMOUNT", "Tarif pajak harus 0–100% (0–10.000 basis poin)");
  }
  const value = BigInt(amount);
  const rate = BigInt(settings.rateBps);
  if (settings.inclusive) {
    const base = toSafeNumber(divideRoundHalfUp(value * BPS, BPS + rate));
    return { base, tax: amount - base, total: amount };
  }
  const tax = toSafeNumber(divideRoundHalfUp(value * rate, BPS));
  return { base: amount, tax, total: toSafeNumber(value + BigInt(tax)) };
}

/** `1000` → `"10%"`, `1050` → `"10,5%"`. */
export function formatTaxRate(rateBps: number): string {
  return `${(rateBps / 100).toLocaleString("id-ID", { maximumFractionDigits: 2 })}%`;
}

/**
 * Membagi `total` ke beberapa bagian sebanding `weights` tanpa selisih
 * pembulatan (metode sisa terbesar). Jumlah hasil selalu = `total`.
 */
export function allocateProportionally(total: number, weights: readonly number[]): number[] {
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  if (weightSum === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (BigInt(total) * BigInt(w)) / BigInt(weightSum));
  const remainders = weights.map((w, i) => ({
    index: i,
    remainder: (BigInt(total) * BigInt(w)) % BigInt(weightSum),
  }));
  let leftover = BigInt(total) - exact.reduce((sum, v) => sum + v, ZERO);
  remainders.sort((a, b) => (b.remainder > a.remainder ? 1 : b.remainder < a.remainder ? -1 : a.index - b.index));
  const result = exact.map(Number);
  for (const { index } of remainders) {
    if (leftover === ZERO) break;
    result[index] += 1;
    leftover -= ONE;
  }
  return result;
}

/**
 * Teks persen dari input pengguna → basis poin integer tanpa float.
 * `"10"` → 1000, `"10,5"` → 1050, `"0.25"` → 25. Maksimal 2 desimal, 0–100%.
 */
export function parseTaxRatePercent(text: string): number | null {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim().replace(/%$/, "").trim());
  if (!match) return null;
  const bps = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return isValidTaxRate(bps) ? bps : null;
}
