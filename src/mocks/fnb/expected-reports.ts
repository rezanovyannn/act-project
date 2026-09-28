/**
 * Hasil laporan dataset Kedai Senja yang DIHITUNG MANUAL (bukan oleh kode)
 * sebagai acuan test. Rincian hitungan ada di komentar agar bisa diperiksa ulang.
 * Aturan laporan mengikuti ADR 010.
 */

export interface ExpectedYear {
  fromDate: string;
  asOf: string;
  /** Saldo kumulatif s.d. `asOf` per kode akun, menurut saldo normal akun. */
  trialBalance: Record<string, number>;
  /** Total kolom debit = total kolom kredit pada Neraca Saldo. */
  trialBalanceTotal: number;
  incomeStatement: {
    revenue: number;
    cogs: number;
    grossProfit: number;
    expenses: number;
    netIncome: number;
  };
  balanceSheet: {
    totalAssets: number;
    totalLiabilities: number;
    /** Laba tahun berjalan (fromDate s.d. asOf). */
    currentYearEarnings: number;
    /** Saldo akun Laba Ditahan + laba tahun-tahun sebelumnya yang belum ditutup. */
    retainedEarnings: number;
    totalEquity: number;
  };
  equityChanges: {
    opening: number;
    contributions: number;
    netIncome: number;
    drawings: number;
    closing: number;
  };
  cashFlow: {
    opening: number;
    operating: number;
    investing: number;
    financing: number;
    netChange: number;
    closing: number;
  };
}

/*
 * ===== 2025 (1 Jan – 31 Des) =====
 * Kas   = 5.000.000 (saldo awal) + 12×8.000.000 (penjualan) − 12×1.000.000 (listrik)
 *         − 12×6.000.000 (setor ke bank) + (−500.000 + 500.000) (void)
 *         + (−800.000 + 800.000 − 700.000) (koreksi)                    = 16.300.000
 * Bank  = 20.000.000 + 10.000.000 (modal) + 15.000.000 (pinjaman) − 6.000.000 (alat)
 *         + 12×22.000.000 − 12×11.000.000 (bahan) − 12×6.000.000 (gaji)
 *         − 12×3.000.000 (sewa) + 12×6.000.000 (setoran kas)
 *         − 10×1.150.000 (cicilan Mar–Des) − 2×2.500.000 (prive)          = 118.500.000
 * Persediaan = 3.000.000 + 132.000.000 − (11×11.000.000 + 10.500.000)    = 3.500.000
 * HPP = 121.000.000 + 10.500.000                                          = 131.500.000
 * Beban: gaji 72.000.000, sewa 36.000.000, listrik 12.000.000,
 *        penyusutan 3.000.000, lain-lain 700.000, bunga 1.500.000         = 125.200.000
 * Pendapatan: makanan 288.000.000 + minuman 72.000.000                    = 360.000.000
 * Laba bersih = 360.000.000 − 131.500.000 − 125.200.000                  = 103.300.000
 * Aset = 16.300.000 + 118.500.000 + 3.500.000 + 18.000.000 − 3.000.000    = 153.300.000
 * Ekuitas = 40.000.000 + 10.000.000 − 5.000.000 + 0 + 103.300.000        = 148.300.000
 * Arus kas: operasi 360.000.000 − 132.000.000 − 72.000.000 − 36.000.000
 *           − 12.000.000 − 700.000 − 1.500.000                            = 105.800.000
 *           investasi −6.000.000; pendanaan 10.000.000 + 15.000.000
 *           − 10.000.000 − 5.000.000 = 10.000.000; transfer kas-bank & saldo awal dikecualikan
 *           kas awal (jurnal saldo awal) 25.000.000 + 109.800.000         = 134.800.000
 */
const Y2025: ExpectedYear = {
  fromDate: "2025-01-01",
  asOf: "2025-12-31",
  trialBalance: {
    "1-1100": 16_300_000,
    "1-1200": 118_500_000,
    "1-1300": 3_500_000,
    "1-1400": 0,
    "1-2100": 18_000_000,
    "1-2190": 3_000_000,
    "2-1100": 0,
    "2-1200": 0,
    "2-2100": 5_000_000,
    "3-1000": 10_000_000,
    "3-2000": 5_000_000,
    "3-3000": 0,
    "3-9000": 40_000_000,
    "4-1000": 288_000_000,
    "4-2000": 72_000_000,
    "5-1000": 131_500_000,
    "6-1000": 72_000_000,
    "6-2000": 36_000_000,
    "6-3000": 12_000_000,
    "6-4000": 3_000_000,
    "6-5000": 1_500_000,
    "6-9000": 700_000,
  },
  trialBalanceTotal: 418_000_000,
  incomeStatement: {
    revenue: 360_000_000,
    cogs: 131_500_000,
    grossProfit: 228_500_000,
    expenses: 125_200_000,
    netIncome: 103_300_000,
  },
  balanceSheet: {
    totalAssets: 153_300_000,
    totalLiabilities: 5_000_000,
    currentYearEarnings: 103_300_000,
    retainedEarnings: 0,
    totalEquity: 148_300_000,
  },
  equityChanges: {
    opening: 40_000_000,
    contributions: 10_000_000,
    netIncome: 103_300_000,
    drawings: 5_000_000,
    closing: 148_300_000,
  },
  cashFlow: {
    opening: 25_000_000,
    operating: 105_800_000,
    investing: -6_000_000,
    financing: 10_000_000,
    netChange: 109_800_000,
    closing: 134_800_000,
  },
};

/*
 * ===== 2026 (1 Jan – 31 Agu), saldo kumulatif sejak 2025 =====
 * Mulai 2026: PB1 10% atas penjualan, penjualan & pembelian kredit + pelunasan.
 * Kas   = 16.300.000 + 8×(9.900.000 − 1.200.000 − 7.900.000)             = 22.700.000
 * Bank  = 118.500.000 + 8×29.700.000 (penjualan) − 8×13.000.000 (bahan tunai)
 *         − 8×7.000.000 (gaji) − 8×3.000.000 (sewa) + 8×7.900.000 (setoran kas)
 *         − 5×1.150.000 (cicilan) − 3.000.000 (prive) − 4.000.000 (freezer)
 *         − (6×3.600.000 + 4.100.000) (setoran PB1 Feb–Agu)
 *         + 3.000.000 + 2.500.000 (pelunasan katering) − 1.500.000 (bayar pemasok)
 *         = 118,5 + 237,6 − 104 − 56 − 24 + 63,2 − 5,75 − 3 − 4 − 25,7 + 5,5 − 1,5 juta
 *                                                                          = 200.850.000
 * Piutang Usaha = 5.500.000 − 3.000.000 − 2.500.000                       = 0
 * Utang Usaha   = 1.500.000 − 1.500.000 + 2.000.000                       = 2.000.000
 * Utang PB1     = (8×3.600.000 + 500.000) − 25.700.000                     = 3.600.000
 * Persediaan = 3.500.000 + 104.000.000 + 1.500.000 + 2.000.000
 *              − (6×13.000.000 + 14.500.000 + 14.300.000)                  = 4.200.000
 * Laba 2026: pendapatan 8×36.000.000 + 5.000.000 (katering) = 293.000.000;
 *   HPP 106.800.000; beban gaji 56.000.000 + sewa 24.000.000
 *   + listrik 9.600.000 + bunga 750.000 = 90.350.000
 *   laba = 293.000.000 − 106.800.000 − 90.350.000                         = 95.850.000
 * Aset = 22.700.000 + 200.850.000 + 0 + 4.200.000 + 22.000.000 − 3.000.000 = 246.750.000
 * Liabilitas = 2.000.000 + 3.600.000 + 0                                  = 5.600.000
 * Ekuitas = 40.000.000 + 10.000.000 − 8.000.000 + 103.300.000 (laba 2025)
 *           + 95.850.000                                                  = 241.150.000
 * Arus kas operasi: penjualan+PB1 8×39.600.000 = 316.800.000
 *   − 104.000.000 − 56.000.000 − 24.000.000 − 9.600.000 − 750.000 (bunga)
 *   − 25.700.000 (setoran PB1) + 5.500.000 (piutang) − 1.500.000 (utang)  = 100.750.000
 *   investasi −4.000.000; pendanaan −5.000.000 − 3.000.000 = −8.000.000
 *   134.800.000 + 88.750.000                                              = 223.550.000
 * Neraca Saldo kumulatif: debit 22,7 + 200,85 + 4,2 + 22 + 8 + 238,3 + 128
 *   + 60 + 21,6 + 3 + 2,25 + 0,7 = 711,6 juta;
 *   kredit 3 + 2 + 3,6 + 10 + 40 + 517 + 136 = 711,6 juta
 */
const Y2026: ExpectedYear = {
  fromDate: "2026-01-01",
  asOf: "2026-08-31",
  trialBalance: {
    "1-1100": 22_700_000,
    "1-1200": 200_850_000,
    "1-1300": 4_200_000,
    "1-1400": 0,
    "1-2100": 22_000_000,
    "1-2190": 3_000_000,
    "2-1100": 2_000_000,
    "2-1200": 3_600_000,
    "2-2100": 0,
    "3-1000": 10_000_000,
    "3-2000": 8_000_000,
    "3-3000": 0,
    "3-9000": 40_000_000,
    "4-1000": 517_000_000,
    "4-2000": 136_000_000,
    "5-1000": 238_300_000,
    "6-1000": 128_000_000,
    "6-2000": 60_000_000,
    "6-3000": 21_600_000,
    "6-4000": 3_000_000,
    "6-5000": 2_250_000,
    "6-9000": 700_000,
  },
  trialBalanceTotal: 711_600_000,
  incomeStatement: {
    revenue: 293_000_000,
    cogs: 106_800_000,
    grossProfit: 186_200_000,
    expenses: 90_350_000,
    netIncome: 95_850_000,
  },
  balanceSheet: {
    totalAssets: 246_750_000,
    totalLiabilities: 5_600_000,
    currentYearEarnings: 95_850_000,
    retainedEarnings: 103_300_000,
    totalEquity: 241_150_000,
  },
  equityChanges: {
    opening: 148_300_000,
    contributions: 0,
    netIncome: 95_850_000,
    drawings: 3_000_000,
    closing: 241_150_000,
  },
  cashFlow: {
    opening: 134_800_000,
    operating: 100_750_000,
    investing: -4_000_000,
    financing: -8_000_000,
    netChange: 88_750_000,
    closing: 223_550_000,
  },
};

export const EXPECTED_REPORTS = { 2025: Y2025, 2026: Y2026 } as const;
