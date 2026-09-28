/**
 * Mesin laporan keuangan dinamis (AGENTS.md prinsip 5, ADR 010).
 * Semua laporan dihitung langsung dari jurnal posted; tidak ada tabel agregat.
 */
import { toIsoDate, yearOf } from "./dates";
import { isLedgerEntry } from "./ledger";
import type { Account, AccountType, IsoDate, JournalEntry, SystemRole } from "./types";

export interface DateRange {
  fromDate: IsoDate;
  toDate: IsoDate;
}

export interface ReportLine {
  accountId: string;
  code: string;
  name: string;
  amount: number;
}

export interface ReportSection {
  lines: ReportLine[];
  total: number;
}

const NOMINAL_TYPES: readonly AccountType[] = ["revenue", "cogs", "expense"];

/** Debit − kredit per akun dari jurnal posted yang lolos `include`. */
function debitNetByAccount(
  entries: readonly JournalEntry[],
  include: (entry: JournalEntry) => boolean,
): Map<string, number> {
  const net = new Map<string, number>();
  for (const entry of entries) {
    if (!isLedgerEntry(entry) || !include(entry)) continue;
    for (const line of entry.lines) {
      net.set(line.accountId, (net.get(line.accountId) ?? 0) + line.debit - line.credit);
    }
  }
  return net;
}

const upTo = (date: IsoDate) => (e: JournalEntry) => e.entryDate <= date;
const within = (range: DateRange) => (e: JournalEntry) =>
  e.entryDate >= range.fromDate && e.entryDate <= range.toDate;

function byCode(a: Account, b: Account) {
  return a.code.localeCompare(b.code);
}

/**
 * Seksi laporan untuk akun yang lolos `predicate`. `sign` = +1 bila saldo
 * positif berarti debit (aset, beban), −1 bila kredit (liabilitas, ekuitas,
 * pendapatan). Akun kontra otomatis bernilai negatif. Akun bernilai 0 disembunyikan.
 */
function section(
  accounts: readonly Account[],
  net: Map<string, number>,
  predicate: (a: Account) => boolean,
  sign: 1 | -1,
): ReportSection {
  const lines = accounts
    .filter(predicate)
    .sort(byCode)
    .map((a) => ({ accountId: a.id, code: a.code, name: a.name, amount: sign * (net.get(a.id) ?? 0) || 0 }))
    .filter((l) => l.amount !== 0);
  return { lines, total: lines.reduce((sum, l) => sum + l.amount, 0) };
}

const ofType = (...types: AccountType[]) => (a: Account) => types.includes(a.accountType);
const withRole = (role: SystemRole) => (a: Account) => a.systemRole === role;

/** Laba (rugi) dari saldo akun nominal pada `net`. */
function earnings(accounts: readonly Account[], net: Map<string, number>): number {
  return -accounts
    .filter((a) => NOMINAL_TYPES.includes(a.accountType))
    .reduce((sum, a) => sum + (net.get(a.id) ?? 0), 0) || 0;
}

// ---------------------------------------------------------------- Neraca Saldo

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  accountType: AccountType;
  debit: number;
  credit: number;
}

export interface TrialBalance {
  asOf: IsoDate;
  rows: TrialBalanceRow[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
}

/** Saldo kumulatif setiap akun per `asOf`, di kolom debit atau kredit. */
export function trialBalance(
  accounts: readonly Account[],
  entries: readonly JournalEntry[],
  asOf: IsoDate,
): TrialBalance {
  const net = debitNetByAccount(entries, upTo(asOf));
  const rows = [...accounts]
    .sort(byCode)
    .map((a) => {
      const value = net.get(a.id) ?? 0;
      return {
        accountId: a.id,
        code: a.code,
        name: a.name,
        accountType: a.accountType,
        debit: value > 0 ? value : 0,
        credit: value < 0 ? -value : 0,
      };
    })
    .filter((r) => r.debit !== 0 || r.credit !== 0);
  const totalDebit = rows.reduce((sum, r) => sum + r.debit, 0);
  const totalCredit = rows.reduce((sum, r) => sum + r.credit, 0);
  return { asOf, rows, totalDebit, totalCredit, balanced: totalDebit === totalCredit };
}

// ------------------------------------------------------------------ Laba Rugi

export interface IncomeStatement {
  range: DateRange;
  revenue: ReportSection;
  cogs: ReportSection;
  grossProfit: number;
  expenses: ReportSection;
  netIncome: number;
}

/**
 * Pendapatan − HPP − Beban = Laba Bersih pada rentang tanggal.
 * Jurnal penutup (`source = closing`) dikecualikan agar laba tahun yang
 * sudah ditutup tidak menjadi nol (ADR 010).
 */
export function incomeStatement(
  accounts: readonly Account[],
  entries: readonly JournalEntry[],
  range: DateRange,
): IncomeStatement {
  const inRange = within(range);
  const net = debitNetByAccount(entries, (e) => inRange(e) && e.source !== "closing");
  const revenue = section(accounts, net, ofType("revenue"), -1);
  const cogs = section(accounts, net, ofType("cogs"), 1);
  const expenses = section(accounts, net, ofType("expense"), 1);
  const grossProfit = revenue.total - cogs.total;
  return { range, revenue, cogs, grossProfit, expenses, netIncome: grossProfit - expenses.total };
}

// --------------------------------------------------------------------- Neraca

export interface BalanceSheet {
  asOf: IsoDate;
  fiscalYearStart: IsoDate;
  assets: ReportSection;
  liabilities: ReportSection;
  /** Akun ekuitas selain Laba Ditahan (Laba Ditahan disajikan terpisah). */
  equity: ReportSection;
  /** Saldo akun Laba Ditahan + laba tahun-tahun sebelumnya yang belum ditutup. */
  retainedEarnings: number;
  /** Laba dari awal tahun buku s.d. `asOf`. */
  currentYearEarnings: number;
  totalEquity: number;
  totalLiabilitiesAndEquity: number;
  balanced: boolean;
}

/** Posisi keuangan per `asOf`; tahun buku = tahun kalender (ADR 010). */
export function balanceSheet(
  accounts: readonly Account[],
  entries: readonly JournalEntry[],
  asOf: IsoDate,
): BalanceSheet {
  const fiscalYearStart = toIsoDate(yearOf(asOf), 1, 1);
  const net = debitNetByAccount(entries, upTo(asOf));
  const priorYears = debitNetByAccount(entries, (e) => e.entryDate < fiscalYearStart);

  const assets = section(accounts, net, ofType("asset"), 1);
  const liabilities = section(accounts, net, ofType("liability"), -1);
  const equity = section(
    accounts,
    net,
    (a) => a.accountType === "equity" && a.systemRole !== "retained_earnings",
    -1,
  );
  const retainedAccount = section(accounts, net, withRole("retained_earnings"), -1).total;
  const retainedEarnings = retainedAccount + earnings(accounts, priorYears);
  const currentYearEarnings = earnings(accounts, net) - earnings(accounts, priorYears);
  const totalEquity = equity.total + retainedEarnings + currentYearEarnings;
  const totalLiabilitiesAndEquity = liabilities.total + totalEquity;

  return {
    asOf,
    fiscalYearStart,
    assets,
    liabilities,
    equity,
    retainedEarnings,
    currentYearEarnings,
    totalEquity,
    totalLiabilitiesAndEquity,
    balanced: assets.total === totalLiabilitiesAndEquity,
  };
}

// ------------------------------------------------------------ Perubahan Modal

export interface EquityChanges {
  range: DateRange;
  /** Ekuitas awal, termasuk jurnal saldo awal di dalam periode. */
  opening: number;
  contributions: number;
  netIncome: number;
  drawings: number;
  /** Mutasi ekuitas lain (mis. akun ekuitas tambahan); normalnya 0. */
  other: number;
  closing: number;
}

/**
 * Saldo Awal + Setoran Modal + Laba Bersih − Prive (+ lain-lain) = Saldo Akhir.
 * Ekuitas = akun ekuitas + laba yang belum ditutup (akun nominal).
 */
export function equityChanges(
  accounts: readonly Account[],
  entries: readonly JournalEntry[],
  range: DateRange,
): EquityChanges {
  const equityTotal = (include: (e: JournalEntry) => boolean) => {
    const net = debitNetByAccount(entries, include);
    return -accounts
      .filter((a) => a.accountType === "equity" || NOMINAL_TYPES.includes(a.accountType))
      .reduce((sum, a) => sum + (net.get(a.id) ?? 0), 0) || 0;
  };
  const inRange = within(range);
  const isOpeningBalance = (e: JournalEntry) => e.source === "opening_balance";

  const opening = equityTotal((e) => e.entryDate < range.fromDate || (inRange(e) && isOpeningBalance(e)));
  const closing = equityTotal(upTo(range.toDate));
  const periodNet = debitNetByAccount(entries, (e) => inRange(e) && !isOpeningBalance(e));
  const contributions = section(accounts, periodNet, withRole("owner_capital"), -1).total;
  const drawings = section(accounts, periodNet, withRole("drawings"), 1).total;
  const netIncome = incomeStatement(accounts, entries, range).netIncome;

  return {
    range,
    opening,
    contributions,
    netIncome,
    drawings,
    other: closing - opening - contributions - netIncome + drawings,
    closing,
  };
}

// ------------------------------------------------------------------- Arus Kas

export type CashFlowActivity = "operating" | "investing" | "financing";

export interface CashFlowStatement {
  range: DateRange;
  /** Saldo kas awal, termasuk jurnal saldo awal di dalam periode. */
  opening: number;
  activities: Record<CashFlowActivity, ReportSection>;
  /** Akun lawan berkategori `none`: kesalahan konfigurasi (ADR 010). */
  unclassified: ReportSection;
  netChange: number;
  closing: number;
  /** Saldo akun kas/bank per akhir periode (untuk invarian). */
  cashBalanceAtEnd: number;
  reconciled: boolean;
}

/**
 * Metode langsung (ADR 010): pada setiap jurnal yang menyentuh akun kas,
 * setiap baris akun non-kas menyumbang `kredit − debit` ke kategori arus kas
 * akunnya. Transfer antar-kas tidak menghasilkan aktivitas; jurnal saldo awal
 * menjadi bagian dari saldo kas awal.
 */
export function cashFlowStatement(
  accounts: readonly Account[],
  entries: readonly JournalEntry[],
  range: DateRange,
): CashFlowStatement {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const isCash = (accountId: string) => byId.get(accountId)?.isCash === true;
  const cashDelta = (entry: JournalEntry) =>
    entry.lines.filter((l) => isCash(l.accountId)).reduce((sum, l) => sum + l.debit - l.credit, 0);

  let opening = 0;
  let cashBalanceAtEnd = 0;
  const flowByAccount = new Map<string, number>();

  for (const entry of entries) {
    if (!isLedgerEntry(entry) || entry.entryDate > range.toDate) continue;
    const delta = cashDelta(entry);
    cashBalanceAtEnd += delta;
    if (entry.entryDate < range.fromDate || entry.source === "opening_balance") {
      opening += delta;
      continue;
    }
    if (!entry.lines.some((l) => isCash(l.accountId))) continue;
    for (const line of entry.lines) {
      if (isCash(line.accountId)) continue;
      flowByAccount.set(line.accountId, (flowByAccount.get(line.accountId) ?? 0) + line.credit - line.debit);
    }
  }

  // `section` memakai debit − kredit; arus kas = kredit − debit baris lawan.
  const asDebitNet = new Map([...flowByAccount].map(([id, v]) => [id, -v]));
  const activity = (category: Account["cashFlowCategory"]) =>
    section(accounts, asDebitNet, (a) => !a.isCash && a.cashFlowCategory === category, -1);

  const activities = {
    operating: activity("operating"),
    investing: activity("investing"),
    financing: activity("financing"),
  };
  const unclassified = activity("none");
  const netChange =
    activities.operating.total + activities.investing.total + activities.financing.total + unclassified.total;
  const closing = opening + netChange;
  return {
    range,
    opening,
    activities,
    unclassified,
    netChange,
    closing,
    cashBalanceAtEnd,
    reconciled: closing === cashBalanceAtEnd,
  };
}
