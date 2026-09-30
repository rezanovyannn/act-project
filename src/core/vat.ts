/**
 * Mode PPN lengkap: PPN Masukan, setoran per masa, dan jurnal transisi (ADR 016).
 * Semua nominal integer Rupiah (ADR 005).
 */
import { endOfMonth, isValidIsoDate } from "./dates";
import { fail } from "./errors";
import { generalLedger } from "./general-ledger";
import { isLedgerEntry } from "./ledger";
import { computeSalesTax, effectiveTaxSettings, type WorkspaceTaxSettings } from "./sales-tax";
import { accountByRole } from "./transactions";
import type { Account, AccountSeed, IsoDate, JournalEntry, JournalEntryInput, JournalLineInput, Workspace } from "./types";

/** Akun sistem mode PPN lengkap, dibuat otomatis bila belum ada. */
export const VAT_ACCOUNT_SEEDS: readonly AccountSeed[] = [
  { code: "1-1500", name: "PPN Masukan", accountType: "asset", normalBalance: "debit", cashFlowCategory: "operating", isCash: false, systemRole: "input_vat" },
  { code: "6-8500", name: "Beban PPN Masukan Tidak Dapat Dikreditkan", accountType: "expense", normalBalance: "debit", cashFlowCategory: "operating", isCash: false, systemRole: "non_creditable_vat" },
];

/** Pengaturan pajak workspace dalam satu objek. */
export function workspaceTaxSettings(workspace: Workspace): WorkspaceTaxSettings {
  return {
    mode: workspace.salesTaxMode,
    label: workspace.salesTaxLabel,
    rateBps: workspace.salesTaxRateBps,
    inclusive: workspace.salesTaxInclusive,
    dppNumerator: workspace.vatDppNumerator,
    dppDenominator: workspace.vatDppDenominator,
  };
}

/** PPN Masukan dari harga beli sebelum PPN (DPP × tarif), sebagai usulan nilai faktur. */
export function computeInputVat(amount: number, settings: WorkspaceTaxSettings): number {
  return computeSalesTax(amount, { ...effectiveTaxSettings(settings), inclusive: false }).tax;
}

export interface VatBalances {
  /** Saldo PPN Keluaran (utang pajak) per tanggal. */
  output: number;
  /** Saldo PPN Masukan yang belum dikreditkan per tanggal. */
  input: number;
}

/** Saldo PPN Keluaran & Masukan dari jurnal posted sampai `asOf`. */
export function vatBalances(entries: readonly JournalEntry[], accounts: readonly Account[], asOf: IsoDate): VatBalances {
  const posted = entries.filter(isLedgerEntry);
  const input = accounts.find((a) => a.systemRole === "input_vat" && a.deletedAt === null);
  return {
    output: generalLedger(posted, accountByRole(accounts, "sales_tax_payable"), { toDate: asOf }).closingBalance,
    input: input ? generalLedger(posted, input, { toDate: asOf }).closingBalance : 0,
  };
}

/** Usulan setoran: kreditkan Masukan sampai sebesar Keluaran; sisanya dikompensasikan. */
export function proposeVatSettlement(balances: VatBalances): { output: number; credited: number; payable: number; carriedForward: number } {
  const output = Math.max(balances.output, 0);
  const credited = Math.min(Math.max(balances.input, 0), output);
  return { output, credited, payable: output - credited, carriedForward: Math.max(balances.input, 0) - credited };
}

export interface VatSettlementInput {
  workspaceId: string;
  /** Bulan masa pajak, format `YYYY-MM`. */
  taxPeriod: string;
  entryDate: IsoDate;
  /** PPN Keluaran yang disetor/dikompensasikan pada masa ini. */
  output: number;
  /** PPN Masukan yang dikreditkan (≤ PPN Keluaran). */
  credited: number;
  /** Wajib bila ada kurang bayar. */
  cashAccountId?: string;
  description?: string;
}

/**
 * Setoran PPN per masa: Dr PPN Keluaran, Cr PPN Masukan (dikreditkan),
 * Cr Kas/Bank (kurang bayar). Lebih bayar tidak dijurnal (dikompensasikan).
 */
export function buildVatSettlement(input: VatSettlementInput, accounts: readonly Account[]): JournalEntryInput {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.taxPeriod)) fail("INVALID_DATE", "Masa pajak tidak valid");
  const periodEnd = endOfMonth(`${input.taxPeriod}-01`);
  if (!isValidIsoDate(input.entryDate)) fail("INVALID_DATE", "Tanggal setoran tidak valid");
  if (input.entryDate < periodEnd) {
    fail("INVALID_DATE", `Tanggal setoran tidak boleh sebelum akhir masa pajak (${periodEnd})`);
  }
  const whole = (n: number) => Number.isSafeInteger(n) && n >= 0;
  if (!whole(input.output) || input.output === 0) fail("INVALID_AMOUNT", "PPN Keluaran yang disetor harus lebih dari 0");
  if (!whole(input.credited)) fail("INVALID_AMOUNT", "PPN Masukan dikreditkan harus bilangan bulat tidak negatif");
  if (input.credited > input.output) {
    fail("INVALID_AMOUNT", "PPN Masukan dikreditkan tidak boleh melebihi PPN Keluaran; sisanya dikompensasikan");
  }
  const payable = input.output - input.credited;
  if (payable > 0 && !input.cashAccountId) fail("INVALID_ACCOUNT", "Pilih akun kas/bank untuk kurang bayar");

  const lines: JournalLineInput[] = [
    { accountId: accountByRole(accounts, "sales_tax_payable").id, description: "PPN Keluaran", debit: input.output, credit: 0 },
  ];
  if (input.credited > 0) {
    lines.push({ accountId: accountByRole(accounts, "input_vat").id, description: "PPN Masukan dikreditkan", debit: 0, credit: input.credited });
  }
  if (payable > 0) lines.push({ accountId: input.cashAccountId!, description: "Kurang bayar", debit: 0, credit: payable });
  return {
    workspaceId: input.workspaceId,
    entryDate: input.entryDate,
    description: input.description?.trim() || `Setoran PPN masa ${input.taxPeriod}`,
    source: "tax_payment",
    lines,
  };
}

/**
 * Jurnal transisi saat keluar dari mode PPN lengkap: saldo PPN Masukan
 * dibebankan (Dr Beban PPN Masukan Tidak Dapat Dikreditkan, Cr PPN Masukan).
 * `null` bila tidak ada saldo.
 */
export function buildVatTransition(
  input: { workspaceId: string; entryDate: IsoDate; inputVatBalance: number },
  accounts: readonly Account[],
): JournalEntryInput | null {
  if (!Number.isSafeInteger(input.inputVatBalance)) fail("INVALID_AMOUNT", "Saldo PPN Masukan tidak valid");
  if (input.inputVatBalance <= 0) return null;
  return {
    workspaceId: input.workspaceId,
    entryDate: input.entryDate,
    description: "Pembebanan saldo PPN Masukan (keluar dari mode PPN lengkap)",
    source: "adjustment",
    lines: [
      { accountId: accountByRole(accounts, "non_creditable_vat").id, debit: input.inputVatBalance, credit: 0 },
      { accountId: accountByRole(accounts, "input_vat").id, debit: 0, credit: input.inputVatBalance },
    ],
  };
}
