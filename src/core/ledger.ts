import { sumAmounts } from "./money";
import type { Account, IsoDate, JournalEntry } from "./types";

export interface AccountTotals {
  debit: number;
  credit: number;
}

export interface BalanceRange {
  /** Inklusif. Kosong = sejak awal. */
  fromDate?: IsoDate;
  /** Inklusif. Kosong = sampai akhir. */
  toDate?: IsoDate;
}

/** Hanya jurnal posted yang belum dihapus yang masuk ke buku besar & laporan. */
export function isLedgerEntry(entry: JournalEntry): boolean {
  return entry.status === "posted" && entry.deletedAt === null;
}

/** Total debit & kredit per akun dari jurnal posted dalam rentang tanggal. */
export function accountTotals(
  entries: readonly JournalEntry[],
  range: BalanceRange = {},
): Map<string, AccountTotals> {
  const debits = new Map<string, number[]>();
  const credits = new Map<string, number[]>();
  for (const entry of entries) {
    if (!isLedgerEntry(entry)) continue;
    if (range.fromDate && entry.entryDate < range.fromDate) continue;
    if (range.toDate && entry.entryDate > range.toDate) continue;
    for (const line of entry.lines) {
      if (!debits.has(line.accountId)) {
        debits.set(line.accountId, []);
        credits.set(line.accountId, []);
      }
      debits.get(line.accountId)!.push(line.debit);
      credits.get(line.accountId)!.push(line.credit);
    }
  }
  const totals = new Map<string, AccountTotals>();
  for (const [accountId, values] of debits) {
    totals.set(accountId, {
      debit: sumAmounts(values),
      credit: sumAmounts(credits.get(accountId)!),
    });
  }
  return totals;
}

/**
 * Saldo menurut saldo normal akun: positif bila searah saldo normal
 * (mis. Kas bersaldo debit, Penjualan bersaldo kredit).
 */
export function normalBalance(
  account: Pick<Account, "normalBalance">,
  totals: AccountTotals | undefined,
): number {
  if (!totals) return 0;
  return account.normalBalance === "debit"
    ? totals.debit - totals.credit
    : totals.credit - totals.debit;
}
