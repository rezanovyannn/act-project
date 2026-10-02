/**
 * Ringkasan kartu workspace di halaman "Workspace Saya" (redesign Okt 2026).
 * Dihitung langsung dari jurnal posted (AGENTS.md prinsip 5).
 */
import { computeDashboardSummary } from "./dashboard";
import { endOfMonth, toIsoDate } from "./dates";
import { isLedgerEntry } from "./ledger";
import { activeOpeningBalance } from "./opening-balance";
import type { Account, IsoDate, JournalEntry } from "./types";

export interface WorkspaceOverview {
  /** Pendapatan bulan berjalan (tanpa jurnal penutup). */
  revenueThisMonth: number;
  /** Jurnal posted bertanggal bulan berjalan. */
  postedThisMonth: number;
  /** Seluruh jurnal posted. */
  postedTotal: number;
  draftCount: number;
  hasOpeningBalance: boolean;
  /** Tanggal jurnal posted terakhir, atau null. */
  lastEntryDate: IsoDate | null;
}

export function workspaceOverview(
  accounts: readonly Account[],
  entries: readonly JournalEntry[],
  today: IsoDate,
): WorkspaceOverview {
  const startDate = toIsoDate(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1);
  const summary = computeDashboardSummary(accounts, entries, { startDate, endDate: endOfMonth(startDate) });
  const posted = entries.filter(isLedgerEntry);
  return {
    revenueThisMonth: summary.revenue,
    postedThisMonth: summary.postedCount,
    postedTotal: posted.length,
    draftCount: summary.draftCount,
    hasOpeningBalance: activeOpeningBalance(entries) !== null,
    lastEntryDate: posted.reduce<IsoDate | null>((last, e) => (last === null || e.entryDate > last ? e.entryDate : last), null),
  };
}
