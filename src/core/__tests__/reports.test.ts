/**
 * Mesin laporan diuji terhadap fixture yang DIHITUNG MANUAL
 * (src/mocks/fnb/expected-reports.ts) dan lima invarian Sub-fase 1D.
 */
import { describe, expect, it } from "vitest";
import {
  balanceSheet,
  cashFlowStatement,
  equityChanges,
  incomeStatement,
  trialBalance,
} from "@/core/reports";
import type { JournalEntry } from "@/core/types";
import { buildFnbMockState } from "@/mocks/fnb/dataset";
import { EXPECTED_REPORTS } from "@/mocks/fnb/expected-reports";

const state = buildFnbMockState();
const { accounts, journals } = state;
const accountByCode = (code: string) => accounts.find((a) => a.code === code)!;

function reportsFor(entries: JournalEntry[], year: 2025 | 2026) {
  const expected = EXPECTED_REPORTS[year];
  const range = { fromDate: expected.fromDate, toDate: expected.asOf };
  return {
    expected,
    tb: trialBalance(accounts, entries, expected.asOf),
    is: incomeStatement(accounts, entries, range),
    bs: balanceSheet(accounts, entries, expected.asOf),
    ec: equityChanges(accounts, entries, range),
    cf: cashFlowStatement(accounts, entries, range),
  };
}

describe.each([2025, 2026] as const)("laporan %i vs fixture hitung manual", (year) => {
  const { expected, tb, is, bs, ec, cf } = reportsFor(journals, year);

  it("Neraca Saldo sama per akun dan total", () => {
    const byCode = Object.fromEntries(
      tb.rows.map((r) => {
        const account = accountByCode(r.code);
        return [r.code, account.normalBalance === "debit" ? r.debit - r.credit : r.credit - r.debit];
      }),
    );
    for (const [code, amount] of Object.entries(expected.trialBalance)) {
      expect(byCode[code] ?? 0, code).toBe(amount);
    }
    expect(tb.totalDebit).toBe(expected.trialBalanceTotal);
    expect(tb.totalCredit).toBe(expected.trialBalanceTotal);
  });

  it("Laba Rugi sama", () => {
    expect({
      revenue: is.revenue.total,
      cogs: is.cogs.total,
      grossProfit: is.grossProfit,
      expenses: is.expenses.total,
      netIncome: is.netIncome,
    }).toEqual(expected.incomeStatement);
  });

  it("Neraca sama", () => {
    expect({
      totalAssets: bs.assets.total,
      totalLiabilities: bs.liabilities.total,
      currentYearEarnings: bs.currentYearEarnings,
      retainedEarnings: bs.retainedEarnings,
      totalEquity: bs.totalEquity,
    }).toEqual(expected.balanceSheet);
  });

  it("Perubahan Modal sama", () => {
    expect({
      opening: ec.opening,
      contributions: ec.contributions,
      netIncome: ec.netIncome,
      drawings: ec.drawings,
      closing: ec.closing,
    }).toEqual(expected.equityChanges);
    expect(ec.other).toBe(0);
  });

  it("Arus Kas sama", () => {
    expect({
      opening: cf.opening,
      operating: cf.activities.operating.total,
      investing: cf.activities.investing.total,
      financing: cf.activities.financing.total,
      netChange: cf.netChange,
      closing: cf.closing,
    }).toEqual(expected.cashFlow);
    expect(cf.unclassified.lines).toEqual([]);
  });

  it("lima invarian akuntansi terpenuhi", () => {
    // 1. Debit = Kredit pada Neraca Saldo
    expect(tb.balanced).toBe(true);
    // 2. Aset = Liabilitas + Ekuitas
    expect(bs.balanced).toBe(true);
    expect(bs.assets.total).toBe(bs.liabilities.total + bs.totalEquity);
    // 3. Laba Rugi = Perubahan Modal; ekuitas akhir = ekuitas Neraca
    expect(ec.netIncome).toBe(is.netIncome);
    expect(ec.closing).toBe(bs.totalEquity);
    // 4. Kas awal + arus bersih = kas akhir = saldo kas di Neraca
    expect(cf.opening + cf.netChange).toBe(cf.closing);
    expect(cf.reconciled).toBe(true);
    const cashInBalanceSheet = bs.assets.lines
      .filter((l) => accounts.find((a) => a.id === l.accountId)!.isCash)
      .reduce((sum, l) => sum + l.amount, 0);
    expect(cf.closing).toBe(cashInBalanceSheet);
    // 5. Semua angka = fixture (diuji di atas)
  });
});

describe("detail penyajian", () => {
  it("akun kontra mengurangi kelompoknya; Prive mengurangi ekuitas", () => {
    const bs = balanceSheet(accounts, journals, "2025-12-31");
    expect(bs.assets.lines.find((l) => l.code === "1-2190")?.amount).toBe(-3_000_000);
    expect(bs.equity.lines.find((l) => l.code === "3-2000")?.amount).toBe(-5_000_000);
    expect(bs.equity.lines.some((l) => l.code === "3-3000")).toBe(false);
  });

  it("arus kas per akun lawan: PB1 & pelunasan masuk operasi, transfer kas-bank tidak muncul", () => {
    const cf = cashFlowStatement(accounts, journals, { fromDate: "2026-01-01", toDate: "2026-08-31" });
    const operating = Object.fromEntries(cf.activities.operating.lines.map((l) => [l.code, l.amount]));
    // PB1 dipungut 8 × 3,6 jt − disetor 25,7 jt = 3,1 jt
    expect(operating["2-1200"]).toBe(3_100_000);
    expect(operating["1-1400"]).toBe(5_500_000);
    expect(operating["2-1100"]).toBe(-1_500_000);
    const allCodes = Object.values(cf.activities).flatMap((s) => s.lines.map((l) => l.code));
    expect(allCodes).not.toContain("1-1100");
    expect(allCodes).not.toContain("1-1200");
  });

  it("draft dan jurnal terhapus tidak ikut laporan", () => {
    const withDeleted = journals.map((e) =>
      e.id === "je-sales-2026-08" ? { ...e, deletedAt: "2026-09-01T00:00:00.000Z" } : e,
    );
    expect(incomeStatement(accounts, withDeleted, { fromDate: "2026-08-01", toDate: "2026-08-31" }).revenue.total).toBe(0);
  });

  it("baris lawan berkategori none tampil sebagai tidak terklasifikasi, kas tetap rekonsiliasi", () => {
    const odd: JournalEntry = {
      ...journals.find((e) => e.id === "je-capital-2025")!,
      id: "je-odd",
      entryNumber: "JU-2025-9999",
      lines: [
        { id: "l1", accountId: accountByCode("1-1100").id, lineNo: 1, description: null, debit: 1_000, credit: 0 },
        { id: "l2", accountId: accountByCode("3-3000").id, lineNo: 2, description: null, debit: 0, credit: 1_000 },
      ],
    };
    const cf = cashFlowStatement(accounts, [...journals, odd], { fromDate: "2025-01-01", toDate: "2025-12-31" });
    expect(cf.unclassified.total).toBe(1_000);
    expect(cf.reconciled).toBe(true);
  });
});

describe("setelah tutup buku 2025 (jurnal penutup)", () => {
  // Jurnal penutup: saldo akun nominal 2025 dipindah ke Laba Ditahan.
  const nominal2025 = trialBalance(accounts, journals, "2025-12-31").rows.filter((r) =>
    ["revenue", "cogs", "expense"].includes(r.accountType),
  );
  const closingLines = nominal2025.map((r, i) => ({
    id: `c${i}`,
    accountId: r.accountId,
    lineNo: i + 1,
    description: null,
    debit: r.credit,
    credit: r.debit,
  }));
  const net = closingLines.reduce((sum, l) => sum + l.debit - l.credit, 0);
  closingLines.push({
    id: "c-re",
    accountId: accountByCode("3-3000").id,
    lineNo: closingLines.length + 1,
    description: null,
    debit: 0,
    credit: net,
  });
  const closing: JournalEntry = {
    ...journals.find((e) => e.id === "je-depreciation-2025")!,
    id: "je-closing-2025",
    entryNumber: "JU-2025-9000",
    source: "closing",
    description: "Tutup buku 2025",
    lines: closingLines,
  };
  const closed = [...journals, closing];

  it("laba ditutup = laba 2025 hitung manual", () => {
    expect(net).toBe(103_300_000);
  });

  it("Laba Rugi 2025 tidak berubah (jurnal penutup dikecualikan)", () => {
    expect(reportsFor(closed, 2025).is.netIncome).toBe(EXPECTED_REPORTS[2025].incomeStatement.netIncome);
  });

  it("Neraca 31 Des 2025: laba tahun berjalan 0, pindah ke Laba Ditahan, total tetap", () => {
    const { bs, ec } = reportsFor(closed, 2025);
    expect(bs.currentYearEarnings).toBe(0);
    expect(bs.retainedEarnings).toBe(103_300_000);
    expect(bs.totalEquity).toBe(EXPECTED_REPORTS[2025].balanceSheet.totalEquity);
    expect(bs.balanced).toBe(true);
    expect(ec.other).toBe(0);
    expect(ec.closing).toBe(bs.totalEquity);
  });

  it("laporan 2026 identik dengan sebelum tutup buku", () => {
    const before = reportsFor(journals, 2026);
    const after = reportsFor(closed, 2026);
    expect(after.bs).toEqual(before.bs);
    expect(after.is).toEqual(before.is);
    expect(after.ec).toEqual(before.ec);
    expect(after.cf).toEqual(before.cf);
  });
});
