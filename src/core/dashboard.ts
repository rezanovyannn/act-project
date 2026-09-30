/**
 * Ringkasan dashboard per periode (bulan). Dihitung langsung dari jurnal
 * posted (AGENTS.md prinsip 5). Laporan formal lengkap dibuat di Sub-fase 1D.
 */
import { withoutClosing } from "./closing";
import { accountTotals, isLedgerEntry, normalBalance } from "./ledger";
import { findPeriodForDate, type PeriodRange } from "./periods";
import type { Account, IsoDate, JournalEntry, SystemRole } from "./types";

export interface DashboardSummary {
  period: PeriodRange;
  /** Saldo akun kas/bank per akhir periode. */
  cashAccounts: { accountId: string; name: string; balance: number }[];
  cashTotal: number;
  /** Mutasi laba rugi dalam periode. */
  revenue: number;
  cogs: number;
  expenses: number;
  netIncome: number;
  /** Saldo per akhir periode. */
  receivables: number;
  payables: number;
  salesTaxPayable: number;
  /** Saldo PPN Masukan yang belum dikreditkan (mode PPN lengkap, ADR 016). */
  inputVat: number;
  draftCount: number;
  postedCount: number;
  /**
   * `true` bila periode punya penjualan atau pembelian bahan baku tetapi
   * belum ada jurnal stok opname, sehingga HPP belum mencerminkan pemakaian
   * bahan (ADR 007).
   */
  cogsPending: boolean;
}

export function computeDashboardSummary(
  accounts: readonly Account[],
  entries: readonly JournalEntry[],
  period: PeriodRange,
): DashboardSummary {
  // Laba rugi periode tanpa jurnal penutup & pembaliknya (ADR 014).
  const inPeriod = accountTotals(withoutClosing(entries), { fromDate: period.startDate, toDate: period.endDate });
  const toEnd = accountTotals(entries, { toDate: period.endDate });

  const sumBalances = (
    totals: ReturnType<typeof accountTotals>,
    predicate: (a: Account) => boolean,
  ) =>
    accounts
      .filter(predicate)
      .reduce((sum, a) => sum + normalBalance(a, totals.get(a.id)), 0);

  // Saldo menurut saldo normal akun; akun kontra (mis. retur) otomatis mengurangi.
  const byType = (type: Account["accountType"]) =>
    accounts
      .filter((a) => a.accountType === type)
      .reduce((sum, a) => {
        const t = inPeriod.get(a.id);
        if (!t) return sum;
        const debitNet = t.debit - t.credit;
        return sum + (type === "revenue" ? -debitNet : debitNet);
      }, 0);

  const byRole = (role: SystemRole) =>
    sumBalances(toEnd, (a) => a.systemRole === role);

  const cashAccounts = accounts
    .filter((a) => a.isCash)
    .map((a) => ({ accountId: a.id, name: a.name, balance: normalBalance(a, toEnd.get(a.id)) }));

  const revenue = byType("revenue");
  const cogs = byType("cogs");
  const expenses = byType("expense");

  const inventoryIds = new Set(
    accounts.filter((a) => a.systemRole === "inventory").map((a) => a.id),
  );
  const postedInPeriod = entries.filter(
    (e) =>
      isLedgerEntry(e) && e.entryDate >= period.startDate && e.entryDate <= period.endDate,
  );
  const touchesInventory = (e: JournalEntry) => e.lines.some((l) => inventoryIds.has(l.accountId));
  const hasOpname = postedInPeriod.some((e) => e.source === "adjustment" && touchesInventory(e));
  const hasInventoryActivity = postedInPeriod.some(
    (e) => e.source !== "adjustment" && touchesInventory(e),
  );

  return {
    period,
    cashAccounts,
    cashTotal: cashAccounts.reduce((sum, a) => sum + a.balance, 0),
    revenue,
    cogs,
    expenses,
    netIncome: revenue - cogs - expenses,
    receivables: byRole("accounts_receivable"),
    payables: byRole("accounts_payable"),
    salesTaxPayable: byRole("sales_tax_payable"),
    inputVat: byRole("input_vat"),
    draftCount: entries.filter((e) => e.status === "draft" && e.deletedAt === null).length,
    postedCount: postedInPeriod.length,
    cogsPending: !hasOpname && (revenue > 0 || hasInventoryActivity),
  };
}

/**
 * Periode default dashboard: periode jurnal posted terakhir yang tidak
 * melewati hari ini; bila belum ada jurnal, periode yang memuat hari ini;
 * selain itu periode pertama.
 */
export function defaultDashboardPeriod<T extends PeriodRange>(
  periods: readonly T[],
  entries: readonly JournalEntry[],
  today: IsoDate,
): T | null {
  const latest = entries
    .filter((e) => isLedgerEntry(e) && e.entryDate <= today)
    .reduce<IsoDate | null>((max, e) => (max === null || e.entryDate > max ? e.entryDate : max), null);
  return (
    (latest !== null ? findPeriodForDate(periods, latest) : null) ??
    findPeriodForDate(periods, today) ??
    periods[0] ??
    null
  );
}
