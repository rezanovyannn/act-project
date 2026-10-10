/**
 * Pajak penjualan (PB1/PPN) dengan aritmetika integer (ADR 005, 012, 015 & 016).
 * Tarif dalam basis poin: 1000 = 10%. DPP berupa pecahan (mis. 11/12).
 * Pembulatan ke Rupiah terdekat, setengah ke atas, sekali per transaksi.
 */
import { fail } from "./errors";

export interface SalesTaxSettings {
  rateBps: number;
  inclusive: boolean;
  /** DPP = harga × pembilang / penyebut (ADR 016). Default 1/1. */
  dppNumerator?: number;
  dppDenominator?: number;
}

/** Nama pajak penjualan yang tampil di UI & akun (ADR 015). Mekanismenya sama. */
export type SalesTaxLabel = "PB1" | "PPN" | "PBJT";
export const SALES_TAX_LABELS: readonly SalesTaxLabel[] = ["PB1", "PPN", "PBJT"];

/** `simple`: pajak keluaran saja (PB1/PPN); `full_vat`: PPN Keluaran & Masukan (ADR 016). */
export type SalesTaxMode = "simple" | "full_vat";

/** Pengaturan pajak penjualan per workspace. */
export interface WorkspaceTaxSettings {
  mode: SalesTaxMode;
  label: SalesTaxLabel;
  rateBps: number;
  inclusive: boolean;
  /** DPP pecahan, hanya dipakai pada mode `full_vat`. */
  dppNumerator: number;
  dppDenominator: number;
}

/** Nilai awal saat mode PPN lengkap dipilih: DPP 11/12 × 12% (ADR 016). */
export const FULL_VAT_DEFAULTS = { rateBps: 1200, dppNumerator: 11, dppDenominator: 12 } as const;

export const MAX_DPP_DENOMINATOR = 1000;

/** Memeriksa pengaturan pajak workspace; melempar AccountingError bila tidak valid. */
export function assertValidTaxSettings(settings: WorkspaceTaxSettings): void {
  if (!isValidTaxRate(settings.rateBps)) {
    fail("INVALID_AMOUNT", "Tarif pajak harus antara 0% dan 100%");
  }
  if (!SALES_TAX_LABELS.includes(settings.label)) {
    fail("INVALID_TAX_LABEL", "Jenis pajak penjualan harus PB1, PPN, atau PBJT");
  }
  if (settings.mode !== "simple" && settings.mode !== "full_vat") {
    fail("INVALID_TAX_LABEL", "Mode pajak tidak dikenal");
  }
  if (settings.mode === "full_vat" && settings.label !== "PPN") {
    fail("INVALID_TAX_LABEL", "Mode PPN lengkap hanya untuk pajak berlabel PPN");
  }
  const { dppNumerator: num, dppDenominator: den } = settings;
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num < 1 || den < 1 || num > den || den > MAX_DPP_DENOMINATOR) {
    fail("INVALID_AMOUNT", `DPP harus pecahan bulat 1–${MAX_DPP_DENOMINATOR} dengan pembilang ≤ penyebut (mis. 11/12)`);
  }
}

/** Pengaturan hitung pajak yang berlaku untuk workspace (DPP hanya pada mode PPN lengkap). */
export function effectiveTaxSettings(settings: WorkspaceTaxSettings): SalesTaxSettings {
  return {
    rateBps: settings.rateBps,
    inclusive: settings.inclusive,
    ...(settings.mode === "full_vat" ? { dppNumerator: settings.dppNumerator, dppDenominator: settings.dppDenominator } : {}),
  };
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
 * Menghitung pajak dari `amount` (ADR 012 & 016):
 * - harga belum termasuk pajak: `amount` = dasar, pajak = dasar × DPP × tarif;
 * - harga sudah termasuk pajak: `amount` = total, dasar dihitung mundur.
 */
export function computeSalesTax(amount: number, settings: SalesTaxSettings): SalesTaxResult {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    fail("INVALID_AMOUNT", "Nominal harus bilangan bulat Rupiah tidak negatif");
  }
  if (!isValidTaxRate(settings.rateBps)) {
    fail("INVALID_AMOUNT", "Tarif pajak harus 0–100% (0–10.000 basis poin)");
  }
  const num = settings.dppNumerator ?? 1;
  const den = settings.dppDenominator ?? 1;
  if (!Number.isSafeInteger(num) || !Number.isSafeInteger(den) || num < 1 || den < 1 || num > den) {
    fail("INVALID_AMOUNT", "DPP harus pecahan bulat dengan pembilang ≤ penyebut");
  }
  const value = BigInt(amount);
  // Pajak = dasar × (pembilang × tarif) / (penyebut × 10.000).
  const taxNum = BigInt(num) * BigInt(settings.rateBps);
  const taxDen = BigInt(den) * BPS;
  if (settings.inclusive) {
    const base = toSafeNumber(divideRoundHalfUp(value * taxDen, taxDen + taxNum));
    return { base, tax: amount - base, total: amount };
  }
  const tax = toSafeNumber(divideRoundHalfUp(value * taxNum, taxDen));
  return { base: amount, tax, total: toSafeNumber(value + BigInt(tax)) };
}

/** `11/12` → `"DPP 11/12"`; DPP penuh → `""`. */
export function formatDpp(numerator: number, denominator: number): string {
  return numerator === denominator ? "" : `DPP ${numerator}/${denominator}`;
}

/** Ringkasan tarif pengaturan pajak: `"PB1 10%"`, `"PPN 12% × DPP 11/12"`. */
export function formatTaxSettings(settings: WorkspaceTaxSettings): string {
  const dpp = settings.mode === "full_vat" ? formatDpp(settings.dppNumerator, settings.dppDenominator) : "";
  return `${settings.label} ${formatTaxRate(settings.rateBps)}${dpp ? ` × ${dpp}` : ""}`;
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
