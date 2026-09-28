/**
 * Memastikan dataset mock F&B valid secara akuntansi dan cocok dengan hasil
 * hitung manual di src/mocks/fnb/expected-reports.ts.
 *
 * Perhitungan laporan di file ini sengaja sederhana dan lokal (bukan mesin
 * laporan), hanya untuk memverifikasi fixture. Mesin laporan dibuat di 1D
 * dan wajib diuji terhadap fixture yang sama.
 */
import { describe, expect, it } from "vitest";
import { validateBalancedLines } from "@/core/journal-validation";
import { accountTotals, isLedgerEntry, normalBalance } from "@/core/ledger";
import { findPeriodForDate } from "@/core/periods";
import type { Account, AccountType, CashFlowCategory, JournalEntry } from "@/core/types";
import { buildFnbMockState } from "@/mocks/fnb/dataset";
import { EXPECTED_REPORTS, type ExpectedYear } from "@/mocks/fnb/expected-reports";

const state = buildFnbMockState();
const accountsById = new Map(state.accounts.map((a) => [a.id, a]));
const posted = state.journals.filter(isLedgerEntry);

function balancesAt(asOf: string, fromDate?: string) {
  const totals = accountTotals(state.journals, { fromDate, toDate: asOf });
  return (account: Account) => normalBalance(account, totals.get(account.id));
}

/** Saldo debit − kredit (tanpa melihat saldo normal) dalam rentang tanggal. */
function debitNetAt(asOf: string, fromDate?: string) {
  const totals = accountTotals(state.journals, { fromDate, toDate: asOf });
  return (account: Account) => {
    const t = totals.get(account.id);
    return t ? t.debit - t.credit : 0;
  };
}

function sumByType(debitNet: (a: Account) => number, types: AccountType[]) {
  return state.accounts
    .filter((a) => types.includes(a.accountType))
    .reduce((sum, a) => sum + debitNet(a), 0);
}

/** Arus kas metode langsung sesuai ADR 010, versi ringkas untuk verifikasi fixture. */
function cashFlow(fromDate: string, toDate: string) {
  const flows: Record<CashFlowCategory, number> = { operating: 0, investing: 0, financing: 0, none: 0 };
  let openingFromEntries = 0;
  const cashDelta = (entry: JournalEntry) =>
    entry.lines
      .filter((l) => accountsById.get(l.accountId)!.isCash)
      .reduce((sum, l) => sum + l.debit - l.credit, 0);

  for (const entry of posted) {
    if (entry.entryDate > toDate) continue;
    if (entry.entryDate < fromDate || entry.source === "opening_balance") {
      openingFromEntries += cashDelta(entry);
      continue;
    }
    const touchesCash = entry.lines.some((l) => accountsById.get(l.accountId)!.isCash);
    if (!touchesCash) continue;
    for (const l of entry.lines) {
      const account = accountsById.get(l.accountId)!;
      if (!account.isCash) flows[account.cashFlowCategory] += l.credit - l.debit;
    }
  }
  return { opening: openingFromEntries, ...flows };
}

describe("dataset mock F&B", () => {
  it("setiap jurnal posted seimbang dan memakai akun yang ada", () => {
    for (const entry of posted) {
      expect(validateBalancedLines(entry.lines), entry.id).toEqual([]);
      for (const l of entry.lines) expect(accountsById.has(l.accountId), l.accountId).toBe(true);
    }
  });

  it("setiap jurnal posted berada di periode yang ada", () => {
    for (const entry of posted) {
      expect(findPeriodForDate(state.periods, entry.entryDate), entry.id).not.toBeNull();
    }
  });

  it("nomor jurnal unik dan berurutan per tahun, draft tanpa nomor", () => {
    for (const year of [2025, 2026]) {
      const numbers = posted
        .filter((e) => e.entryDate.startsWith(String(year)))
        .map((e) => e.entryNumber);
      expect(numbers).toEqual(
        numbers.map((_, i) => `JU-${year}-${String(i + 1).padStart(4, "0")}`),
      );
    }
    const drafts = state.journals.filter((e) => e.status === "draft");
    expect(drafts).toHaveLength(1);
    expect(drafts[0].entryNumber).toBeNull();
  });

  it("tautan void/koreksi valid: dibalik sekali, baris ditukar, tidak ada pembalik atas pembalik", () => {
    const reversals = posted.filter((e) => e.source === "reversal");
    expect(reversals).toHaveLength(2);
    const targets = reversals.map((r) => r.reversalOf);
    expect(new Set(targets).size).toBe(targets.length);
    for (const reversal of reversals) {
      const original = posted.find((e) => e.id === reversal.reversalOf)!;
      expect(original.source).not.toBe("reversal");
      expect(reversal.entryDate >= original.entryDate).toBe(true);
      expect(reversal.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual(
        original.lines.map((l) => [l.accountId, l.credit, l.debit]),
      );
    }
    const corrected = posted.find((e) => e.correctionOf);
    expect(targets).toContain(corrected?.correctionOf);
  });

  it("memuat akun Prive dengan saldo", () => {
    const prive = state.accounts.find((a) => a.systemRole === "drawings")!;
    expect(prive.name).toBe("Prive");
    expect(balancesAt("2025-12-31")(prive)).toBeGreaterThan(0);
  });
});

describe.each([2025, 2026] as const)("fixture hitung manual %i", (year) => {
  const expected: ExpectedYear = EXPECTED_REPORTS[year];
  const balance = balancesAt(expected.asOf);
  const ytd = balancesAt(expected.asOf, expected.fromDate);
  const net = debitNetAt(expected.asOf);
  const ytdNet = debitNetAt(expected.asOf, expected.fromDate);

  it("Neraca Saldo per akun sesuai dan total debit = total kredit", () => {
    const actual = Object.fromEntries(state.accounts.map((a) => [a.code, balance(a)]));
    expect(actual).toEqual(expected.trialBalance);

    const totals = accountTotals(state.journals, { toDate: expected.asOf });
    let debitColumn = 0;
    let creditColumn = 0;
    for (const account of state.accounts) {
      const t = totals.get(account.id) ?? { debit: 0, credit: 0 };
      const net = t.debit - t.credit;
      if (net >= 0) debitColumn += net;
      else creditColumn -= net;
    }
    expect(debitColumn).toBe(creditColumn);
    expect(debitColumn).toBe(expected.trialBalanceTotal);
  });

  it("Laba Rugi sesuai", () => {
    const revenue = 0 - sumByType(ytdNet, ["revenue"]);
    const cogs = sumByType(ytdNet, ["cogs"]);
    const expenses = sumByType(ytdNet, ["expense"]);
    expect({
      revenue,
      cogs,
      grossProfit: revenue - cogs,
      expenses,
      netIncome: revenue - cogs - expenses,
    }).toEqual(expected.incomeStatement);
  });

  it("Neraca sesuai dan Aset = Liabilitas + Ekuitas", () => {
    const totalAssets = sumByType(net, ["asset"]);
    const totalLiabilities = 0 - sumByType(net, ["liability"]);
    const equityAccounts = 0 - sumByType(net, ["equity"]);
    const retainedAccount = balance(state.accounts.find((a) => a.systemRole === "retained_earnings")!);
    const priorYears = debitNetAt(`${year - 1}-12-31`);
    const priorEarnings = 0 - sumByType(priorYears, ["revenue", "cogs", "expense"]);
    const currentYearEarnings = expected.incomeStatement.netIncome;
    const totalEquity = equityAccounts + priorEarnings + currentYearEarnings;

    expect({
      totalAssets,
      totalLiabilities,
      currentYearEarnings,
      retainedEarnings: retainedAccount + priorEarnings,
      totalEquity,
    }).toEqual(expected.balanceSheet);
    expect(totalAssets).toBe(totalLiabilities + totalEquity);
  });

  it("Perubahan Modal sinkron dengan Laba Rugi dan Neraca", () => {
    const e = expected.equityChanges;
    expect(e.netIncome).toBe(expected.incomeStatement.netIncome);
    expect(e.opening + e.contributions + e.netIncome - e.drawings).toBe(e.closing);
    expect(e.closing).toBe(expected.balanceSheet.totalEquity);

    const byRole = (role: Account["systemRole"]) =>
      ytd(state.accounts.find((a) => a.systemRole === role)!);
    const openingBalanceJournal = year === 2025 ? byRole("opening_balance_equity") : 0;
    expect(byRole("owner_capital")).toBe(e.contributions);
    expect(byRole("drawings")).toBe(e.drawings);
    if (year === 2025) expect(openingBalanceJournal).toBe(e.opening);
    else expect(e.opening).toBe(EXPECTED_REPORTS[2025].equityChanges.closing);
  });

  it("Arus Kas (metode langsung, ADR 010) sesuai dan kas akhir = kas di Neraca", () => {
    const flow = cashFlow(expected.fromDate, expected.asOf);
    expect(flow.none).toBe(0);
    const netChange = flow.operating + flow.investing + flow.financing;
    expect({
      opening: flow.opening,
      operating: flow.operating,
      investing: flow.investing,
      financing: flow.financing,
      netChange,
      closing: flow.opening + netChange,
    }).toEqual(expected.cashFlow);

    const cashInBalanceSheet = state.accounts
      .filter((a) => a.isCash)
      .reduce((sum, a) => sum + balance(a), 0);
    expect(cashInBalanceSheet).toBe(expected.cashFlow.closing);
  });
});
