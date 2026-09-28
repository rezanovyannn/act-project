import { describe, expect, it } from "vitest";
import { endOfMonth, isValidIsoDate } from "@/core/dates";
import { formatRupiah, isValidAmount, sumAmounts } from "@/core/money";
import { nextEntryNumber } from "@/core/numbering";
import {
  findPeriodForDate,
  monthlyPeriodsForYear,
  monthlyPeriodsUntilYearEnd,
  periodsOverlap,
} from "@/core/periods";

describe("money", () => {
  it("hanya menerima integer aman non-negatif", () => {
    expect(isValidAmount(0)).toBe(true);
    expect(isValidAmount(1_250_000)).toBe(true);
    expect(isValidAmount(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(isValidAmount(-1)).toBe(false);
    expect(isValidAmount(1000.5)).toBe(false);
    expect(isValidAmount(0.1 + 0.2)).toBe(false);
    expect(isValidAmount(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    expect(isValidAmount(Number.NaN)).toBe(false);
    expect(isValidAmount(Infinity)).toBe(false);
    expect(isValidAmount("1000")).toBe(false);
  });

  it("menjumlahkan dan menolak overflow", () => {
    expect(sumAmounts([1_000, 2_500, 0])).toBe(3_500);
    expect(sumAmounts([])).toBe(0);
    expect(() => sumAmounts([Number.MAX_SAFE_INTEGER, 1])).toThrow(RangeError);
    expect(() => sumAmounts([1.5])).toThrow(RangeError);
  });

  it("memformat Rupiah dengan titik ribuan", () => {
    expect(formatRupiah(1_234_567)).toBe("Rp 1.234.567");
    expect(formatRupiah(0)).toBe("Rp 0");
    expect(formatRupiah(-50_000)).toBe("-Rp 50.000");
  });
});

describe("dates", () => {
  it("memvalidasi tanggal kalender nyata", () => {
    expect(isValidIsoDate("2026-01-31")).toBe(true);
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2025-02-29")).toBe(false);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("2026-04-31")).toBe(false);
    expect(isValidIsoDate("2026-4-1")).toBe(false);
    expect(isValidIsoDate("")).toBe(false);
    expect(isValidIsoDate(20260101)).toBe(false);
  });

  it("menghitung akhir bulan", () => {
    expect(endOfMonth("2025-02-10")).toBe("2025-02-28");
    expect(endOfMonth("2024-02-01")).toBe("2024-02-29");
    expect(endOfMonth("2026-12-05")).toBe("2026-12-31");
  });
});

describe("periods", () => {
  it("men-seed periode bulanan dari bulan mulai sampai Desember", () => {
    const periods = monthlyPeriodsUntilYearEnd("2025-03-15");
    expect(periods).toHaveLength(10);
    expect(periods[0]).toEqual({ startDate: "2025-03-01", endDate: "2025-03-31" });
    expect(periods[9]).toEqual({ startDate: "2025-12-01", endDate: "2025-12-31" });
  });

  it("membuat 12 periode satu tahun buku", () => {
    const periods = monthlyPeriodsForYear(2024);
    expect(periods).toHaveLength(12);
    expect(periods[1]).toEqual({ startDate: "2024-02-01", endDate: "2024-02-29" });
  });

  it("mencari periode untuk tanggal, termasuk batas awal & akhir", () => {
    const periods = monthlyPeriodsForYear(2026);
    expect(findPeriodForDate(periods, "2026-05-01")?.startDate).toBe("2026-05-01");
    expect(findPeriodForDate(periods, "2026-05-31")?.startDate).toBe("2026-05-01");
    expect(findPeriodForDate(periods, "2027-01-01")).toBeNull();
  });

  it("mendeteksi periode tumpang tindih", () => {
    const jan = { startDate: "2026-01-01", endDate: "2026-01-31" };
    expect(periodsOverlap(jan, { startDate: "2026-01-31", endDate: "2026-02-28" })).toBe(true);
    expect(periodsOverlap(jan, { startDate: "2026-02-01", endDate: "2026-02-28" })).toBe(false);
  });
});

describe("numbering", () => {
  it("memberi nomor urut per tahun buku", () => {
    expect(nextEntryNumber([], "2026-03-01")).toBe("JU-2026-0001");
    expect(
      nextEntryNumber(["JU-2026-0001", "JU-2026-0007", "JU-2025-0099", null], "2026-03-01"),
    ).toBe("JU-2026-0008");
    expect(nextEntryNumber(["JU-2026-0003"], "2027-01-02")).toBe("JU-2027-0001");
  });
});
