/**
 * Dataset simulasi F&B "Kedai Senja" (fiktif), tahun buku 2025 penuh dan
 * 2026 s.d. Agustus, ditambah satu draft di September 2026.
 * Angka dibuat bulat dan berpola bulanan agar laporan bisa dihitung manual;
 * hasil hitung manual ada di ./expected-reports.ts.
 *
 * Belum memuat pajak maupun transaksi kredit (Keputusan Tertunda 1 & 2).
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
    cashToBank: 6_000_000, loanMonths: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
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
    salesCash: 9_000_000, salesBank: 27_000_000, salesFood: 28_000_000, salesDrink: 8_000_000,
    cashToBank: 7_000_000, loanMonths: [1, 2, 3, 4, 5],
    cogs: (m) => (m === 8 ? 12_300_000 : 13_000_000),
  }),
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
      reversalOf: spec.reversalOf ? entryId(spec.reversalOf) : null,
      correctionOf: spec.correctionOf ? entryId(spec.correctionOf) : null,
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
  };
}
