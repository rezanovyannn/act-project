/**
 * Metrik tambahan dashboard (redesign Okt 2026, ROADMAP Catatan Keputusan 33–36).
 * Semua dihitung langsung dari jurnal posted (AGENTS.md prinsip 5); persentase
 * disimpan sebagai basis poin integer (10000 = 100%).
 */
import { daysInMonth, endOfMonth, toIsoDate } from "./dates";
import { isLedgerEntry } from "./ledger";
import type { PeriodRange } from "./periods";
import { reversedEntryIds } from "./reversal";
import { outstandingAmount } from "./settlement";
import { mulDivRound } from "./stock";
import type { Account, IsoDate, JournalEntry } from "./types";

/** Rentang bulan sebelumnya dari periode bulanan. */
export function previousMonth(period: PeriodRange): PeriodRange {
  const year = Number(period.startDate.slice(0, 4));
  const month = Number(period.startDate.slice(5, 7));
  const startDate = month === 1 ? toIsoDate(year - 1, 12, 1) : toIsoDate(year, month - 1, 1);
  return { startDate, endDate: endOfMonth(startDate) };
}

/** `part / whole` dalam basis poin; null bila pembagi ≤ 0. */
export function ratioBps(part: number, whole: number): number | null {
  return whole > 0 ? mulDivRound(part, 10_000, whole) : null;
}

/** Pertumbuhan `current` terhadap `previous` dalam basis poin; null bila pembanding 0. */
export function growthBps(current: number, previous: number): number | null {
  return previous === 0 ? null : mulDivRound(current - previous, 10_000, Math.abs(previous));
}

const inPeriod = (entry: JournalEntry, period: PeriodRange) =>
  entry.entryDate >= period.startDate && entry.entryDate <= period.endDate;

/** Jurnal posted yang masih berlaku: belum di-void dan bukan jurnal pembalik. */
function activeEntries(entries: readonly JournalEntry[]): JournalEntry[] {
  const reversed = reversedEntryIds(entries);
  return entries.filter((e) => isLedgerEntry(e) && !reversed.has(e.id) && e.source !== "reversal");
}

/** Jumlah transaksi penjualan (jurnal bersumber `revenue`) yang berlaku dalam periode. */
export function salesTransactionCount(entries: readonly JournalEntry[], period: PeriodRange): number {
  return activeEntries(entries).filter((e) => e.source === "revenue" && inPeriod(e, period)).length;
}

export interface WeeklyCash {
  label: string;
  fromDate: IsoDate;
  toDate: IsoDate;
  inflow: number;
  outflow: number;
}

/**
 * Kas masuk & keluar per pekan dalam periode bulanan (hari 1–7, 8–14, 15–21,
 * 22–28, 29–akhir). Per jurnal dihitung efek bersih ke akun kas/bank, sehingga
 * transfer antar kas tidak dihitung; saldo awal tidak termasuk.
 */
export function weeklyCashFlow(
  accounts: readonly Account[],
  entries: readonly JournalEntry[],
  period: PeriodRange,
): WeeklyCash[] {
  const year = Number(period.startDate.slice(0, 4));
  const month = Number(period.startDate.slice(5, 7));
  const lastDay = daysInMonth(year, month);
  const starts = [1, 8, 15, 22, 29].filter((d) => d <= lastDay);
  const weeks: WeeklyCash[] = starts.map((day, i) => ({
    label: `Pekan ${i + 1}`,
    fromDate: toIsoDate(year, month, day),
    toDate: toIsoDate(year, month, Math.min(i + 1 < starts.length ? starts[i + 1] - 1 : lastDay, lastDay)),
    inflow: 0,
    outflow: 0,
  }));
  const cashIds = new Set(accounts.filter((a) => a.isCash).map((a) => a.id));
  for (const entry of entries) {
    if (!isLedgerEntry(entry) || entry.source === "opening_balance" || !inPeriod(entry, period)) continue;
    const net = entry.lines.filter((l) => cashIds.has(l.accountId)).reduce((t, l) => t + l.debit - l.credit, 0);
    if (net === 0) continue;
    const week = weeks.find((w) => entry.entryDate >= w.fromDate && entry.entryDate <= w.toDate);
    if (!week) continue;
    if (net > 0) week.inflow += net;
    else week.outflow -= net;
  }
  return weeks;
}

export interface OpenClaims {
  receivables: number;
  payables: number;
}

/** Jumlah transaksi kredit yang masih punya sisa tagihan per `asOf` (ADR 012). */
export function openClaimCounts(
  accounts: readonly Account[],
  entries: readonly JournalEntry[],
  asOf: IsoDate,
): OpenClaims {
  const lookup = new Map(accounts.map((a) => [a.id, a]));
  const active = activeEntries(entries).filter((e) => e.entryDate <= asOf);
  const counts: OpenClaims = { receivables: 0, payables: 0 };
  for (const entry of active) {
    if (entry.source === "settlement") continue;
    const roles = new Set(entry.lines.map((l) => lookup.get(l.accountId)?.systemRole));
    const kind = roles.has("accounts_receivable") ? "receivables" : roles.has("accounts_payable") ? "payables" : null;
    if (!kind) continue;
    const settlements = active.filter((s) => s.settlementOf === entry.id);
    if (outstandingAmount(entry, settlements, lookup) > 0) counts[kind] += 1;
  }
  return counts;
}

export interface LedgerCheck {
  totalDebit: number;
  totalCredit: number;
  difference: number;
  balanced: boolean;
}

/** Total debit & kredit seluruh jurnal posted s.d. `asOf` (buku besar seimbang?). */
export function ledgerCheck(entries: readonly JournalEntry[], asOf: IsoDate): LedgerCheck {
  let totalDebit = 0;
  let totalCredit = 0;
  for (const entry of entries) {
    if (!isLedgerEntry(entry) || entry.entryDate > asOf) continue;
    for (const line of entry.lines) {
      totalDebit += line.debit;
      totalCredit += line.credit;
    }
  }
  return { totalDebit, totalCredit, difference: totalDebit - totalCredit, balanced: totalDebit === totalCredit };
}
