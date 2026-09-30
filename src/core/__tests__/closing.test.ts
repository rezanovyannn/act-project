/**
 * Tutup buku akhir tahun (ADR 014) dengan dataset Kedai Senja 2025.
 * Angka harapan dihitung manual dari src/mocks/fnb/expected-reports.ts:
 * pendapatan 360 jt, HPP + beban 256,7 jt, laba 103,3 jt, prive 5 jt
 * → Laba Ditahan 98,3 jt; total ekuitas tetap 148,3 jt.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { activeClosingEntries, buildClosingPlan, validateClosingResult } from "@/core/closing";
import { computeDashboardSummary } from "@/core/dashboard";
import { AccountingError, type ValidationCode } from "@/core/errors";
import { balanceSheet, cashFlowStatement, equityChanges, incomeStatement, trialBalance } from "@/core/reports";
import { FNB_TEMPLATE } from "@/modules/fnb/template";
import { buildFnbMockState, FNB_WORKSPACE_ID } from "@/mocks/fnb/dataset";
import { EXPECTED_REPORTS } from "@/mocks/fnb/expected-reports";
import { monthlyPeriodsForYear } from "@/core/periods";
import { createFnbWorkspace, createTestEnv, entry, line } from "./helpers";

async function expectCode(promise: Promise<unknown>, code: ValidationCode) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AccountingError);
  expect((error as AccountingError).hasCode(code)).toBe(true);
}

const WS = FNB_WORKSPACE_ID;
const acc = (code: string) => `acc-${code}`;
const tuples = (lines: { accountId: string; debit: number; credit: number }[]) =>
  lines.map((l) => [l.accountId, l.debit, l.credit]);

describe("tutup buku 2025 (dataset Kedai Senja)", () => {
  let env: ReturnType<typeof createTestEnv>;
  const range2025 = { fromDate: "2025-01-01", toDate: "2025-12-31" };
  const range2026 = { fromDate: "2026-01-01", toDate: "2026-08-31" };

  async function data() {
    const [accounts, journals, periods] = await Promise.all([
      env.repos.accounts.listByWorkspace(WS),
      env.repos.journals.listByWorkspace(WS),
      env.repos.periods.listByWorkspace(WS),
    ]);
    return { accounts, journals, periods };
  }

  async function reopenDecember2025() {
    await env.repos.periods.setStatus("per-2025-12", "open", "Persiapan tutup buku 2025");
  }

  beforeEach(() => {
    env = createTestEnv(buildFnbMockState);
  });

  it("rencana: 4 jurnal penutup bertanggal 31 Des lewat Ikhtisar Laba Rugi", async () => {
    const { accounts, journals } = await data();
    const plan = buildClosingPlan(WS, 2025, accounts, journals);
    expect(plan).toMatchObject({
      date: "2025-12-31",
      revenue: 360_000_000,
      cogs: 131_500_000,
      expenses: 125_200_000,
      netIncome: 103_300_000,
      drawings: 5_000_000,
    });
    expect(plan.entries.map((e) => [e.source, e.entryDate])).toEqual(Array(4).fill(["closing", "2025-12-31"]));
    const [revenue, costs, summary, drawings] = plan.entries;
    expect(tuples(revenue.lines)).toEqual([
      [acc("4-1000"), 288_000_000, 0],
      [acc("4-2000"), 72_000_000, 0],
      [acc("3-8000"), 0, 360_000_000],
    ]);
    expect(tuples(costs.lines)).toEqual([
      [acc("5-1000"), 0, 131_500_000],
      [acc("6-1000"), 0, 72_000_000],
      [acc("6-2000"), 0, 36_000_000],
      [acc("6-3000"), 0, 12_000_000],
      [acc("6-4000"), 0, 3_000_000],
      [acc("6-5000"), 0, 1_500_000],
      [acc("6-9000"), 0, 700_000],
      [acc("3-8000"), 256_700_000, 0],
    ]);
    expect(tuples(summary.lines)).toEqual([
      [acc("3-8000"), 103_300_000, 0],
      [acc("3-3000"), 0, 103_300_000],
    ]);
    expect(tuples(drawings.lines)).toEqual([
      [acc("3-2000"), 0, 5_000_000],
      [acc("3-3000"), 5_000_000, 0],
    ]);
  });

  it("pratinjau: Desember terkunci menghalangi tutup buku", async () => {
    const preview = await env.closingService.preview(WS, 2025);
    expect(preview.blockers.join(" ")).toContain("Desember 2025 dikunci");
    await expectCode(env.closingService.close(WS, 2025), "INVALID_CLOSING");
  });

  it("tutup buku: posting atomik, periode 2025 terkunci, laporan tetap memenuhi invarian", async () => {
    const before = await data();
    await reopenDecember2025();
    expect((await env.closingService.preview(WS, 2025)).blockers).toEqual([]);

    const posted = await env.closingService.close(WS, 2025);
    expect(posted.map((e) => [e.source, e.status, e.entryDate])).toEqual(Array(4).fill(["closing", "posted", "2025-12-31"]));

    const { accounts, journals, periods } = await data();
    expect(periods.filter((p) => p.startDate.startsWith("2025")).every((p) => p.status === "closed")).toBe(true);
    const logs = await env.repos.auditLogs.listByWorkspace(WS, { entityId: "per-2025-12" });
    expect(logs[0]).toMatchObject({ action: "close", reason: "Tutup buku 2025" });

    // Laba Rugi 2025 tidak berubah (jurnal penutup dikecualikan).
    expect(incomeStatement(accounts, journals, range2025).netIncome).toBe(103_300_000);

    // Neraca Saldo 31 Des: akun nominal & Prive nol, Laba Ditahan 98,3 jt.
    const tb = trialBalance(accounts, journals, "2025-12-31");
    const byCode = Object.fromEntries(tb.rows.map((r) => [r.code, r.credit - r.debit]));
    expect(byCode["3-3000"]).toBe(98_300_000);
    for (const code of ["4-1000", "5-1000", "6-1000", "3-2000", "3-8000"]) expect(byCode[code] ?? 0, code).toBe(0);
    expect(tb.totalDebit).toBe(156_300_000);
    expect(tb.balanced).toBe(true);

    // Neraca 31 Des: laba tahun berjalan 0, laba ditahan 98,3 jt, total ekuitas tetap.
    const bs = balanceSheet(accounts, journals, "2025-12-31");
    expect(bs).toMatchObject({ currentYearEarnings: 0, retainedEarnings: 98_300_000, totalEquity: 148_300_000, balanced: true });

    // Perubahan Modal 2025 identik dengan fixture.
    const ec = equityChanges(accounts, journals, range2025);
    expect(ec).toMatchObject({ ...EXPECTED_REPORTS[2025].equityChanges, other: 0 });

    // Arus kas & dashboard Desember tidak terpengaruh.
    expect(cashFlowStatement(accounts, journals, range2025)).toEqual(cashFlowStatement(before.accounts, before.journals, range2025));
    const december = { startDate: "2025-12-01", endDate: "2025-12-31" };
    expect(computeDashboardSummary(accounts, journals, december).netIncome).toBe(
      computeDashboardSummary(before.accounts, before.journals, december).netIncome,
    );

    // Laporan 2026 tetap sama totalnya; Prive kumulatif kini hanya 2026 (3 jt).
    const bs2026 = balanceSheet(accounts, journals, "2026-08-31");
    expect(bs2026).toMatchObject({ retainedEarnings: 98_300_000, totalEquity: EXPECTED_REPORTS[2026].balanceSheet.totalEquity, balanced: true });
    expect(bs2026.equity.lines.find((l) => l.code === "3-2000")?.amount).toBe(-3_000_000);
    expect(incomeStatement(accounts, journals, range2026)).toEqual(incomeStatement(before.accounts, before.journals, range2026));
    expect(equityChanges(accounts, journals, range2026)).toEqual(equityChanges(before.accounts, before.journals, range2026));
  });

  it("tidak bisa ditutup dua kali; jurnal penutup tidak bisa di-void satu per satu atau diposting manual", async () => {
    await reopenDecember2025();
    const [first] = await env.closingService.close(WS, 2025);
    await expectCode(env.closingService.close(WS, 2025), "INVALID_CLOSING");
    await expectCode(env.repos.journals.closeFiscalYear(WS, 2025, [ { ...first, lines: first.lines } ]), "DUPLICATE_CLOSING");
    await env.repos.periods.setStatus("per-2025-12", "open", "Uji void jurnal penutup");
    await expectCode(env.journalService.voidJournal(first.id, "2025-12-31"), "INVALID_CLOSING");
    await expectCode(
      env.journalService.postJournal(entry(WS, [line(acc("4-1000"), 1, 0), line(acc("3-8000"), 0, 1)], { source: "closing", entryDate: "2025-12-31" })),
      "INVALID_CLOSING",
    );
    await expectCode(
      env.repos.journals.postJournal(entry(WS, [line(acc("4-1000"), 1, 0), line(acc("3-8000"), 0, 1)], { source: "closing", entryDate: "2025-12-31" })),
      "INVALID_CLOSING",
    );
  });

  it("repository menolak jurnal penutup yang tidak menolkan semua akun", async () => {
    await reopenDecember2025();
    const { accounts, journals } = await data();
    const plan = buildClosingPlan(WS, 2025, accounts, journals);
    await expectCode(env.repos.journals.closeFiscalYear(WS, 2025, plan.entries.slice(0, 2)), "INVALID_CLOSING");
    // Atomik: tidak ada jurnal penutup yang tersimpan, periode tetap terbuka.
    expect(activeClosingEntries(await env.repos.journals.listByWorkspace(WS), 2025)).toEqual([]);
    expect((await env.repos.periods.listByWorkspace(WS)).find((p) => p.id === "per-2025-12")?.status).toBe("open");
  });

  it("batalkan tutup buku: butuh Desember terbuka, membalik semua jurnal penutup, laporan kembali seperti semula", async () => {
    const before = await data();
    await reopenDecember2025();
    await env.closingService.close(WS, 2025);

    await expectCode(env.closingService.cancel(WS, 2025), "PERIOD_CLOSED");
    await env.repos.periods.setStatus("per-2025-12", "open", "Salah tutup buku");
    const reversals = await env.closingService.cancel(WS, 2025);
    expect(reversals.map((r) => [r.source, r.entryDate])).toEqual(Array(4).fill(["reversal", "2025-12-31"]));
    await expectCode(env.closingService.cancel(WS, 2025), "CLOSING_NOT_FOUND");

    const { accounts, journals } = await data();
    expect(activeClosingEntries(journals, 2025)).toEqual([]);
    for (const range of [range2025, range2026]) {
      expect(incomeStatement(accounts, journals, range)).toEqual(incomeStatement(before.accounts, before.journals, range));
      expect(equityChanges(accounts, journals, range)).toEqual(equityChanges(before.accounts, before.journals, range));
    }
    const bs = balanceSheet(accounts, journals, "2025-12-31");
    expect(bs).toMatchObject({ currentYearEarnings: 103_300_000, retainedEarnings: 0, totalEquity: 148_300_000 });

    // Dapat ditutup ulang setelah dibatalkan.
    await env.closingService.close(WS, 2025);
    const reclosed = await data();
    expect(balanceSheet(reclosed.accounts, reclosed.journals, "2025-12-31").retainedEarnings).toBe(98_300_000);
  });
});

describe("tutup buku: rugi, workspace lama tanpa akun Ikhtisar", () => {
  it("rugi ditutup dengan Laba Ditahan di debit", async () => {
    const env = createTestEnv();
    const ws = await createFnbWorkspace(env);
    const id = (code: string) => ws.byCode(code).id;
    await env.journalService.postJournal(entry(ws.workspace.id, [line(id("4-1000"), 0, 400), line(id("1-1100"), 400, 0)], { entryDate: "2026-12-10" }));
    await env.journalService.postJournal(entry(ws.workspace.id, [line(id("6-2000"), 1_000, 0), line(id("1-1100"), 0, 1_000)], { entryDate: "2026-12-11" }));
    const plan = buildClosingPlan(ws.workspace.id, 2026, ws.accounts, await env.repos.journals.listByWorkspace(ws.workspace.id));
    expect(plan.netIncome).toBe(-600);
    expect(tuples(plan.entries[2].lines)).toEqual([
      [id("3-8000"), 0, 600],
      [id("3-3000"), 600, 0],
    ]);
    const posted = await env.closingService.close(ws.workspace.id, 2026);
    expect(posted).toHaveLength(3); // tanpa prive
    expect(validateClosingResult(2026, ws.accounts, await env.repos.journals.listByWorkspace(ws.workspace.id))).toEqual([]);
  });

  it("membuat akun Ikhtisar Laba Rugi otomatis untuk workspace lama", async () => {
    const env = createTestEnv();
    const workspace = await env.repos.workspaces.createWithSeed(
      { ownerId: "owner-a", name: "Lama", templateType: "fnb", booksStartDate: "2026-01-01", salesTax: FNB_TEMPLATE.salesTaxDefaults },
      FNB_TEMPLATE.accounts.filter((a) => a.systemRole !== "income_summary"),
      monthlyPeriodsForYear(2026),
    );
    const accounts = await env.repos.accounts.listByWorkspace(workspace.id);
    const id = (code: string) => accounts.find((a) => a.code === code)!.id;
    await env.journalService.postJournal(entry(workspace.id, [line(id("1-1100"), 500, 0), line(id("4-1000"), 0, 500)], { entryDate: "2026-06-01" }));
    await env.closingService.close(workspace.id, 2026);
    const after = await env.repos.accounts.listByWorkspace(workspace.id);
    expect(after.find((a) => a.systemRole === "income_summary")).toMatchObject({ code: "3-8000", name: "Ikhtisar Laba Rugi" });
  });
});
