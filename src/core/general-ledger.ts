/**
 * Buku Besar per akun: saldo awal, mutasi, dan saldo berjalan menurut saldo
 * normal akun. Hanya jurnal posted (AGENTS.md prinsip 5).
 */
import { isLedgerEntry } from "./ledger";
import type { Account, IsoDate, JournalEntry, JournalSource } from "./types";

export interface LedgerRow {
  entryId: string;
  entryNumber: string | null;
  entryDate: IsoDate;
  description: string;
  counterparty: string | null;
  source: JournalSource;
  lineDescription: string | null;
  debit: number;
  credit: number;
  /** Saldo setelah baris ini, positif = searah saldo normal akun. */
  balance: number;
}

export interface GeneralLedger {
  openingBalance: number;
  rows: LedgerRow[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
}

export function generalLedger(
  entries: readonly JournalEntry[],
  account: Pick<Account, "id" | "normalBalance">,
  range: { fromDate?: IsoDate; toDate?: IsoDate } = {},
): GeneralLedger {
  const effect = (debit: number, credit: number) =>
    account.normalBalance === "debit" ? debit - credit : credit - debit;

  const ordered = entries
    .filter(isLedgerEntry)
    .filter((e) => !range.toDate || e.entryDate <= range.toDate)
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        a.entry.entryDate.localeCompare(b.entry.entryDate) ||
        (a.entry.postedAt ?? "").localeCompare(b.entry.postedAt ?? "") ||
        a.index - b.index,
    )
    .map(({ entry }) => entry);

  let openingBalance = 0;
  let balance = 0;
  let totalDebit = 0;
  let totalCredit = 0;
  const rows: LedgerRow[] = [];

  for (const entry of ordered) {
    const beforeRange = range.fromDate !== undefined && entry.entryDate < range.fromDate;
    for (const line of entry.lines) {
      if (line.accountId !== account.id) continue;
      if (beforeRange) {
        openingBalance += effect(line.debit, line.credit);
        continue;
      }
      if (rows.length === 0) balance = openingBalance;
      balance += effect(line.debit, line.credit);
      totalDebit += line.debit;
      totalCredit += line.credit;
      rows.push({
        entryId: entry.id,
        entryNumber: entry.entryNumber,
        entryDate: entry.entryDate,
        description: entry.description,
        counterparty: entry.counterparty,
        source: entry.source,
        lineDescription: line.description,
        debit: line.debit,
        credit: line.credit,
        balance,
      });
    }
  }

  return {
    openingBalance,
    rows,
    totalDebit,
    totalCredit,
    closingBalance: openingBalance + effect(totalDebit, totalCredit),
  };
}
