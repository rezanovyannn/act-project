import { describe, expect, it } from "vitest";
import {
  growthBps,
  ledgerCheck,
  openClaimCounts,
  previousMonth,
  ratioBps,
  salesTransactionCount,
  weeklyCashFlow,
} from "@/core/dashboard-insights";
import { formatPercentBps } from "@/core/format";
import { buildSettlement } from "@/core/transactions";
import { createFnbWorkspace, createTestEnv, entry, line } from "./helpers";

describe("metrik dashboard (redesign)", () => {
  it("rasio, pertumbuhan, dan format persen", () => {
    expect(ratioBps(18_200_000, 42_850_000)).toBe(4247); // 42,47%
    expect(ratioBps(1, 0)).toBeNull();
    expect(growthBps(114, 100)).toBe(1400);
    expect(growthBps(80, 100)).toBe(-2000);
    expect(growthBps(-50, -100)).toBe(5000); // rugi mengecil = membaik
    expect(growthBps(10, 0)).toBeNull();
    expect(formatPercentBps(1420, true)).toBe("+14,2%");
    expect(formatPercentBps(-2000, true)).toBe("-20,0%");
    expect(formatPercentBps(4247)).toBe("42,5%");
  });

  it("bulan sebelumnya, termasuk lintas tahun", () => {
    expect(previousMonth({ startDate: "2026-10-01", endDate: "2026-10-31" })).toEqual({ startDate: "2026-09-01", endDate: "2026-09-30" });
    expect(previousMonth({ startDate: "2026-01-01", endDate: "2026-01-31" })).toEqual({ startDate: "2025-12-01", endDate: "2025-12-31" });
  });

  it("kas mingguan, transaksi penjualan, tagihan belum lunas, buku besar seimbang", async () => {
    const env = createTestEnv();
    const { workspace, accounts, byCode } = await createFnbWorkspace(env);
    const kas = byCode("1-1100").id;
    const bank = byCode("1-1200").id;
    const jual = byCode("4-1000").id;
    const post = (input: Parameters<typeof env.journalService.postJournal>[0]) => env.journalService.postJournal(input);

    await post(entry(workspace.id, [line(kas, 5_000_000, 0), line(byCode("3-9000").id, 0, 5_000_000)], { entryDate: "2026-03-01", source: "opening_balance", description: "Saldo awal" }));
    await post(entry(workspace.id, [line(kas, 300_000, 0), line(jual, 0, 300_000)], { entryDate: "2026-03-02", source: "revenue" }));
    const voided = await post(entry(workspace.id, [line(kas, 50_000, 0), line(jual, 0, 50_000)], { entryDate: "2026-03-03", source: "revenue" }));
    await env.journalService.voidJournal(voided.id, "2026-03-03");
    await post(entry(workspace.id, [line(byCode("6-2000").id, 120_000, 0), line(kas, 0, 120_000)], { entryDate: "2026-03-09", source: "expense" }));
    await post(entry(workspace.id, [line(bank, 1_000_000, 0), line(kas, 0, 1_000_000)], { entryDate: "2026-03-16", description: "Setor ke bank" }));
    const credit = await post(entry(workspace.id, [line(byCode("1-1400").id, 200_000, 0), line(jual, 0, 200_000)], { entryDate: "2026-03-30", source: "revenue", counterparty: "PT A" }));
    await post(entry(workspace.id, [line(byCode("1-1400").id, 70_000, 0), line(jual, 0, 70_000)], { entryDate: "2026-03-30", source: "revenue", counterparty: "PT B" }));
    const accountsNow = await env.repos.accounts.listByWorkspace(workspace.id);
    await post(buildSettlement({ target: credit, entryDate: "2026-03-31", amount: 200_000, cashAccountId: kas }, accountsNow));

    const journals = await env.repos.journals.listByWorkspace(workspace.id);
    const march = { startDate: "2026-03-01", endDate: "2026-03-31" };
    const weeks = weeklyCashFlow(accounts, journals, march);
    expect(weeks.map((w) => [w.label, w.fromDate, w.toDate, w.inflow, w.outflow])).toEqual([
      // Penjualan 300.000 + penjualan 50.000 & pembaliknya (bersih 0 di minggu yang sama, dihitung per jurnal).
      ["Pekan 1", "2026-03-01", "2026-03-07", 350_000, 50_000],
      ["Pekan 2", "2026-03-08", "2026-03-14", 0, 120_000],
      ["Pekan 3", "2026-03-15", "2026-03-21", 0, 0], // transfer kas → bank tidak dihitung
      ["Pekan 4", "2026-03-22", "2026-03-28", 0, 0],
      ["Pekan 5", "2026-03-29", "2026-03-31", 200_000, 0], // pelunasan piutang
    ]);
    // Penjualan berlaku: 300.000 tunai + dua penjualan kredit (yang di-void tidak dihitung).
    expect(salesTransactionCount(journals, march)).toBe(3);
    expect(openClaimCounts(accounts, journals, "2026-03-31")).toEqual({ receivables: 1, payables: 0 });
    expect(openClaimCounts(accounts, journals, "2026-03-30")).toEqual({ receivables: 2, payables: 0 });
    expect(ledgerCheck(journals, "2026-03-31")).toMatchObject({ balanced: true, difference: 0 });
    expect(weeklyCashFlow(accounts, journals, { startDate: "2026-02-01", endDate: "2026-02-28" })).toHaveLength(4);
  });
});
