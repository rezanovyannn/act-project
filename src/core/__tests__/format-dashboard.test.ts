import { describe, expect, it } from "vitest";
import { computeDashboardSummary, defaultDashboardPeriod } from "@/core/dashboard";
import {
  capitalizeWords,
  formatAccounting,
  formatDate,
  formatMonth,
  formatNumber,
  parseRupiahInput,
  todayIsoDate,
} from "@/core/format";
import { buildFnbMockState } from "@/mocks/fnb/dataset";

describe("format", () => {
  it("angka negatif ditulis dalam kurung", () => {
    expect(formatAccounting(1_250_000)).toBe("Rp 1.250.000");
    expect(formatAccounting(-1_250_000)).toBe("(Rp 1.250.000)");
    expect(formatAccounting(0)).toBe("Rp 0");
    expect(formatNumber(36_000_000)).toBe("36.000.000");
  });

  it("huruf awal tiap kata dikapitalisasi", () => {
    expect(capitalizeWords("barang dagang")).toBe("Barang Dagang");
    expect(capitalizeWords("bahan baku")).toBe("Bahan Baku");
    expect(capitalizeWords("")).toBe("");
  });

  it("mem-parse input nominal Rupiah menjadi integer", () => {
    expect(parseRupiahInput("1.250.000")).toBe(1_250_000);
    expect(parseRupiahInput("Rp 75.000")).toBe(75_000);
    expect(parseRupiahInput(" 5000 ")).toBe(5000);
    expect(parseRupiahInput("")).toBe(0);
    expect(parseRupiahInput("1.250,50")).toBeNull();
    expect(parseRupiahInput("-5000")).toBeNull();
    expect(parseRupiahInput("12a")).toBeNull();
    expect(parseRupiahInput("99999999999999999999")).toBeNull();
  });

  it("memformat tanggal dan bulan dalam bahasa Indonesia", () => {
    expect(formatDate("2026-08-31")).toBe("31 Agu 2026");
    expect(formatMonth("2026-08-01")).toBe("Agustus 2026");
    expect(formatDate("bukan-tanggal")).toBe("bukan-tanggal");
  });

  it("mengambil tanggal hari ini dari waktu lokal", () => {
    expect(todayIsoDate(new Date(2026, 8, 28, 23, 59))).toBe("2026-09-28");
  });
});

describe("dashboard", () => {
  const state = buildFnbMockState();
  const august = { startDate: "2026-08-01", endDate: "2026-08-31" };

  it("merangkum Agustus 2026 sesuai hitung manual", () => {
    const summary = computeDashboardSummary(state.accounts, state.journals, august);
    // Pendapatan 28 jt + 8 jt; HPP opname Agustus; beban gaji 7 jt + sewa 3 jt + listrik 1,2 jt.
    expect(summary).toMatchObject({
      revenue: 36_000_000,
      cogs: 14_300_000,
      expenses: 11_200_000,
      netIncome: 10_500_000,
      cashTotal: 223_550_000,
      receivables: 0,
      payables: 2_000_000,
      salesTaxPayable: 3_600_000,
      draftCount: 1,
      cogsPending: false,
    });
    expect(summary.cashAccounts.map((a) => [a.name, a.balance])).toEqual([
      ["Kas", 22_700_000],
      ["Bank", 200_850_000],
    ]);
  });

  it("menandai HPP belum disesuaikan bila ada penjualan tanpa stok opname", () => {
    const withoutOpname = state.journals.filter((e) => e.id !== "je-opname-2026-08");
    expect(computeDashboardSummary(state.accounts, withoutOpname, august).cogsPending).toBe(true);

    const september = { startDate: "2026-09-01", endDate: "2026-09-30" };
    const empty = computeDashboardSummary(state.accounts, state.journals, september);
    expect(empty).toMatchObject({ revenue: 0, cogsPending: false, postedCount: 0 });
  });

  it("periode default = periode jurnal posted terakhir s.d. hari ini", () => {
    expect(defaultDashboardPeriod(state.periods, state.journals, "2026-09-28")?.startDate).toBe(
      "2026-08-01",
    );
    expect(defaultDashboardPeriod(state.periods, [], "2026-03-15")?.startDate).toBe("2026-03-01");
    expect(defaultDashboardPeriod(state.periods, [], "2030-01-01")?.startDate).toBe("2025-01-01");
  });
});
