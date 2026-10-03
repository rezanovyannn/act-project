/**
 * Dataset simulasi F&B "Kedai Senja" (fiktif), tahun buku 2025 penuh dan
 * 2026 s.d. Agustus, ditambah satu draft di September 2026.
 * Angka dibuat bulat dan berpola bulanan agar laporan bisa dihitung manual;
 * hasil hitung manual ada di ./expected-reports.ts.
 *
 * Mulai 2026 kedai memungut PB1 10% (harga belum termasuk PB1) dan ada
 * transaksi kredit beserta pelunasan (ADR 012).
 */
import { endOfMonth, toIsoDate, yearOf } from "@/core/dates";
import { formatEntryNumber } from "@/core/numbering";
import { monthlyPeriodsForYear } from "@/core/periods";
import type {
  Account,
  JournalEntry,
  JournalSource,
  Period,
  Workspace,
} from "@/core/types";
import { MOCK_SCHEMA_VERSION, type MockState } from "@/repositories/mock/mock-database";
import { FNB_ACCOUNTS } from "@/modules/fnb/template";

export const MOCK_OWNER_ID = "mock-owner";
export const FNB_WORKSPACE_ID = "ws-kedai-senja";

const SEED_TIMESTAMP = "2025-01-01T00:00:00.000Z";

export const accountId = (code: string) => `acc-${code}`;

/** [kode akun, debit, kredit] */
type LineSpec = [code: string, debit: number, credit: number];

interface EntrySpec {
  key: string;
  date: string;
  description: string;
  source: JournalSource;
  lines: LineSpec[];
  draft?: boolean;
  counterparty?: string;
  settlementOf?: string;
  reversalOf?: string;
  correctionOf?: string;
}

function monthlyEntries(year: number, months: number, spec: {
  rent: number;
  purchase: number;
  utilities: number;
  salary: number;
  salesCash: number;
  salesBank: number;
  salesFood: number;
  salesDrink: number;
  /** PB1 yang dipungut pada rekap penjualan (0 = belum wajib pungut). */
  salesTax: number;
  /** Setoran PB1 bulan sebelumnya, tanggal 10 (0 = tidak ada). */
  taxRemittance: (month: number) => number;
  cashToBank: number;
  loanMonths: number[];
  cogs: (month: number) => number;
}): EntrySpec[] {
  const entries: EntrySpec[] = [];
  for (let m = 1; m <= months; m++) {
    const d = (day: number) => toIsoDate(year, m, day);
    const tag = `${year}-${String(m).padStart(2, "0")}`;
    entries.push(
      { key: `rent-${tag}`, date: d(1), description: "Sewa tempat bulanan", source: "expense",
        lines: [["6-2000", spec.rent, 0], ["1-1200", 0, spec.rent]] },
      { key: `purchase-${tag}`, date: d(5), description: "Pembelian bahan baku bulanan", source: "purchase",
        lines: [["1-1300", spec.purchase, 0], ["1-1200", 0, spec.purchase]] },
    );
    const remittance = spec.taxRemittance(m);
    if (remittance > 0) {
      entries.push({ key: `pb1-${tag}`, date: d(10), description: "Setoran PB1 bulan lalu", source: "tax_payment",
        lines: [["2-1200", remittance, 0], ["1-1200", 0, remittance]] });
    }
    if (spec.loanMonths.includes(m)) {
      entries.push({ key: `loan-${tag}`, date: d(15), description: "Cicilan pokok & bunga pinjaman bank", source: "manual",
        lines: [["2-2100", 1_000_000, 0], ["6-5000", 150_000, 0], ["1-1200", 0, 1_150_000]] });
    }
    entries.push(
      { key: `utilities-${tag}`, date: d(20), description: "Listrik & air", source: "expense",
        lines: [["6-3000", spec.utilities, 0], ["1-1100", 0, spec.utilities]] },
      { key: `salary-${tag}`, date: d(25), description: "Gaji karyawan", source: "expense",
        lines: [["6-1000", spec.salary, 0], ["1-1200", 0, spec.salary]] },
      { key: `sales-${tag}`, date: d(28), description: "Rekap penjualan bulanan (tunai & QRIS)", source: "revenue",
        lines: [
          ["1-1100", spec.salesCash, 0],
          ["1-1200", spec.salesBank, 0],
          ["4-1000", 0, spec.salesFood],
          ["4-2000", 0, spec.salesDrink],
          ...(spec.salesTax > 0 ? [["2-1200", 0, spec.salesTax] as LineSpec] : []),
        ] },
      { key: `transfer-${tag}`, date: d(28), description: "Setor kas ke bank", source: "manual",
        lines: [["1-1200", spec.cashToBank, 0], ["1-1100", 0, spec.cashToBank]] },
      { key: `opname-${tag}`, date: endOfMonth(d(1)), description: "Penyesuaian stok opname ke HPP", source: "adjustment",
        lines: [["5-1000", spec.cogs(m), 0], ["1-1300", 0, spec.cogs(m)]] },
    );
  }
  return entries;
}

const ENTRY_SPECS: EntrySpec[] = [
  // ---- 2025 ----
  { key: "opening", date: "2025-01-01", description: "Saldo awal pembukuan", source: "opening_balance",
    lines: [
      ["1-1100", 5_000_000, 0],
      ["1-1200", 20_000_000, 0],
      ["1-1300", 3_000_000, 0],
      ["1-2100", 12_000_000, 0],
      ["3-9000", 0, 40_000_000],
    ] },
  { key: "capital-2025", date: "2025-01-05", description: "Setoran modal pemilik", source: "manual",
    lines: [["1-1200", 10_000_000, 0], ["3-1000", 0, 10_000_000]] },
  { key: "loan-2025", date: "2025-02-01", description: "Pencairan pinjaman bank", source: "manual",
    lines: [["1-1200", 15_000_000, 0], ["2-2100", 0, 15_000_000]] },
  { key: "equipment-2025", date: "2025-03-10", description: "Pembelian mesin espresso", source: "manual",
    lines: [["1-2100", 6_000_000, 0], ["1-1200", 0, 6_000_000]] },
  ...monthlyEntries(2025, 12, {
    rent: 3_000_000, purchase: 11_000_000, utilities: 1_000_000, salary: 6_000_000,
    salesCash: 8_000_000, salesBank: 22_000_000, salesFood: 24_000_000, salesDrink: 6_000_000,
    salesTax: 0, taxRemittance: () => 0, cashToBank: 6_000_000, loanMonths: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    cogs: (m) => (m === 12 ? 10_500_000 : 11_000_000),
  }),
  { key: "drawings-2025-06", date: "2025-06-30", description: "Prive pemilik", source: "manual",
    lines: [["3-2000", 2_500_000, 0], ["1-1200", 0, 2_500_000]] },
  { key: "drawings-2025-12", date: "2025-12-30", description: "Prive pemilik", source: "manual",
    lines: [["3-2000", 2_500_000, 0], ["1-1200", 0, 2_500_000]] },
  { key: "depreciation-2025", date: "2025-12-31", description: "Penyusutan peralatan 2025", source: "adjustment",
    lines: [["6-4000", 3_000_000, 0], ["1-2190", 0, 3_000_000]] },
  // Contoh void: jurnal salah input lalu dibalik.
  { key: "misc-wrong", date: "2025-07-15", description: "Perbaikan kulkas (salah input)", source: "expense",
    lines: [["6-9000", 500_000, 0], ["1-1100", 0, 500_000]] },
  { key: "misc-wrong-void", date: "2025-07-16", description: "Pembalik jurnal perbaikan kulkas", source: "reversal",
    reversalOf: "misc-wrong",
    lines: [["6-9000", 0, 500_000], ["1-1100", 500_000, 0]] },
  // Contoh koreksi: nominal 800.000 seharusnya 700.000.
  { key: "misc-typo", date: "2025-08-12", description: "Servis mesin espresso", source: "expense",
    lines: [["6-9000", 800_000, 0], ["1-1100", 0, 800_000]] },
  { key: "misc-typo-reversal", date: "2025-08-13", description: "Pembalik untuk koreksi servis mesin espresso", source: "reversal",
    reversalOf: "misc-typo",
    lines: [["6-9000", 0, 800_000], ["1-1100", 800_000, 0]] },
  { key: "misc-typo-fixed", date: "2025-08-13", description: "Servis mesin espresso", source: "expense",
    correctionOf: "misc-typo",
    lines: [["6-9000", 700_000, 0], ["1-1100", 0, 700_000]] },

  // ---- 2026 (s.d. Agustus) ----
  ...monthlyEntries(2026, 8, {
    rent: 3_000_000, purchase: 13_000_000, utilities: 1_200_000, salary: 7_000_000,
    // Penjualan 36.000.000 + PB1 10% 3.600.000 = 39.600.000 diterima.
    salesCash: 9_900_000, salesBank: 29_700_000, salesFood: 28_000_000, salesDrink: 8_000_000,
    salesTax: 3_600_000,
    // Juli menyetor PB1 Juni termasuk PB1 katering (3.600.000 + 500.000).
    taxRemittance: (m) => (m === 1 ? 0 : m === 7 ? 4_100_000 : 3_600_000),
    cashToBank: 7_900_000, loanMonths: [1, 2, 3, 4, 5],
    // Juli & Agustus termasuk pembelian bahan kredit (1.500.000 dan 2.000.000).
    cogs: (m) => (m === 7 ? 14_500_000 : m === 8 ? 14_300_000 : 13_000_000),
  }),
  // Penjualan kredit katering + PB1, dilunasi dua kali.
  { key: "catering-2026-06", date: "2026-06-10", description: "Katering acara kantor (tempo 60 hari)", source: "revenue",
    counterparty: "PT Maju Bersama",
    lines: [["1-1400", 5_500_000, 0], ["4-1000", 0, 5_000_000], ["2-1200", 0, 500_000]] },
  { key: "catering-receipt-1", date: "2026-07-10", description: "Pelunasan sebagian katering", source: "settlement",
    counterparty: "PT Maju Bersama", settlementOf: "catering-2026-06",
    lines: [["1-1200", 3_000_000, 0], ["1-1400", 0, 3_000_000]] },
  { key: "catering-receipt-2", date: "2026-08-10", description: "Pelunasan akhir katering", source: "settlement",
    counterparty: "PT Maju Bersama", settlementOf: "catering-2026-06",
    lines: [["1-1200", 2_500_000, 0], ["1-1400", 0, 2_500_000]] },
  // Pembelian bahan baku kredit: satu lunas, satu masih terutang per 31 Agustus.
  { key: "supplier-2026-07", date: "2026-07-02", description: "Pembelian daging (kredit)", source: "purchase",
    counterparty: "CV Sumber Pangan",
    lines: [["1-1300", 1_500_000, 0], ["2-1100", 0, 1_500_000]] },
  { key: "supplier-2026-07-paid", date: "2026-07-20", description: "Pembayaran utang pembelian daging", source: "settlement",
    counterparty: "CV Sumber Pangan", settlementOf: "supplier-2026-07",
    lines: [["2-1100", 1_500_000, 0], ["1-1200", 0, 1_500_000]] },
  { key: "supplier-2026-08", date: "2026-08-03", description: "Pembelian sayur & bumbu (kredit)", source: "purchase",
    counterparty: "CV Sumber Pangan",
    lines: [["1-1300", 2_000_000, 0], ["2-1100", 0, 2_000_000]] },
  { key: "drawings-2026-04", date: "2026-04-30", description: "Prive pemilik", source: "manual",
    lines: [["3-2000", 3_000_000, 0], ["1-1200", 0, 3_000_000]] },
  { key: "equipment-2026", date: "2026-05-15", description: "Pembelian freezer", source: "manual",
    lines: [["1-2100", 4_000_000, 0], ["1-1200", 0, 4_000_000]] },
  { key: "draft-2026-09", date: "2026-09-05", description: "Beli gas LPG (belum diposting)", source: "expense", draft: true,
    lines: [["6-9000", 250_000, 0], ["1-1100", 0, 250_000]] },
];

const entryId = (key: string) => `je-${key}`;

function buildJournals(): JournalEntry[] {
  // Nomor jurnal diberikan urut tanggal per tahun buku, seperti saat posting.
  const ordered = ENTRY_SPECS.map((spec, index) => ({ spec, index })).sort(
    (a, b) => a.spec.date.localeCompare(b.spec.date) || a.index - b.index,
  );
  const sequenceByYear = new Map<number, number>();

  return ordered.map(({ spec, index }) => {
    const posted = !spec.draft;
    let entryNumber: string | null = null;
    if (posted) {
      const year = yearOf(spec.date);
      const next = (sequenceByYear.get(year) ?? 0) + 1;
      sequenceByYear.set(year, next);
      entryNumber = formatEntryNumber(year, next);
    }
    const timestamp = `${spec.date}T10:00:${String(index % 60).padStart(2, "0")}.${String(index).padStart(3, "0")}Z`;
    return {
      id: entryId(spec.key),
      workspaceId: FNB_WORKSPACE_ID,
      entryNumber,
      entryDate: spec.date,
      description: spec.description,
      status: posted ? "posted" : "draft",
      source: spec.source,
      counterparty: spec.counterparty ?? null,
      settlementOf: spec.settlementOf ? entryId(spec.settlementOf) : null,
      reversalOf: spec.reversalOf ? entryId(spec.reversalOf) : null,
      correctionOf: spec.correctionOf ? entryId(spec.correctionOf) : null,
      returnOf: null,
      postedAt: posted ? timestamp : null,
      createdAt: timestamp,
      updatedAt: timestamp,
      deletedAt: null,
      lines: spec.lines.map(([code, debit, credit], lineIndex) => ({
        id: `${entryId(spec.key)}-l${lineIndex + 1}`,
        accountId: accountId(code),
        lineNo: lineIndex + 1,
        description: null,
        debit,
        credit,
        itemId: null,
        quantity: null,
      })),
    } satisfies JournalEntry;
  });
}

function buildAccounts(): Account[] {
  return FNB_ACCOUNTS.map((seed) => ({
    ...seed,
    id: accountId(seed.code),
    workspaceId: FNB_WORKSPACE_ID,
    isActive: true,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    deletedAt: null,
  }));
}

function buildPeriods(): Period[] {
  // 2025 sudah dikunci; 2026 masih terbuka.
  return [2025, 2026].flatMap((year) =>
    monthlyPeriodsForYear(year).map((range) => ({
      ...range,
      id: `per-${range.startDate.slice(0, 7)}`,
      workspaceId: FNB_WORKSPACE_ID,
      status: year === 2025 ? "closed" : "open",
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    }) satisfies Period),
  );
}

export function buildFnbMockState(): MockState {
  const workspace: Workspace = {
    id: FNB_WORKSPACE_ID,
    ownerId: MOCK_OWNER_ID,
    name: "Kedai Senja",
    templateType: "fnb",
    currency: "IDR",
    booksStartDate: "2025-01-01",
    salesTaxLabel: "PB1",
    salesTaxMode: "simple",
    vatDppNumerator: 1,
    vatDppDenominator: 1,
    inventoryMethod: "periodic",
    costMethodHistory: [],
    stockValuation: "average",
    salesTaxRateBps: 1000,
    salesTaxInclusive: false,
    createdAt: SEED_TIMESTAMP,
    updatedAt: SEED_TIMESTAMP,
    deletedAt: null,
  };
  return {
    schemaVersion: MOCK_SCHEMA_VERSION,
    workspaces: [workspace],
    accounts: buildAccounts(),
    periods: buildPeriods(),
    journals: buildJournals(),
    items: [],
    stockCounts: [],
    auditLogs: [],
  };
}
