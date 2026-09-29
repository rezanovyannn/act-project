import {
  activeClosingEntries,
  buildClosingPlan,
  closingDate,
  INCOME_SUMMARY_SEED,
  type ClosingPlan,
} from "../closing";
import { yearOf } from "../dates";
import { fail } from "../errors";
import { isLedgerEntry } from "../ledger";
import type { IAccountRepository, IJournalRepository, IPeriodRepository } from "../ports";
import type { Account, JournalEntry } from "../types";

export interface ClosingPreview {
  plan: ClosingPlan;
  /** Jurnal penutup aktif tahun ini (kosong = belum ditutup). */
  activeClosing: JournalEntry[];
  /** Halangan yang mencegah tutup buku (harus kosong). */
  blockers: string[];
  /** Peringatan yang sebaiknya diperiksa dulu. */
  warnings: string[];
}

/** Tutup buku akhir tahun (ADR 014). */
export class ClosingService {
  constructor(
    private readonly deps: {
      journals: IJournalRepository;
      accounts: IAccountRepository;
      periods: IPeriodRepository;
    },
  ) {}

  async preview(workspaceId: string, year: number): Promise<ClosingPreview> {
    const [accounts, journals, periods] = await Promise.all([
      this.deps.accounts.listByWorkspace(workspaceId),
      this.deps.journals.listByWorkspace(workspaceId),
      this.deps.periods.listByWorkspace(workspaceId),
    ]);
    const plan = buildClosingPlan(workspaceId, year, withIncomeSummary(workspaceId, accounts), journals);
    const activeClosing = activeClosingEntries(journals, year);

    const blockers: string[] = [];
    const december = periods.find((p) => p.startDate === `${year}-12-01`);
    if (activeClosing.length > 0) blockers.push(`Tahun buku ${year} sudah ditutup.`);
    if (!december) blockers.push(`Belum ada periode Desember ${year}.`);
    else if (december.status !== "open" && activeClosing.length === 0) {
      blockers.push(`Periode Desember ${year} dikunci. Buka kembali dulu untuk menutup buku.`);
    }
    if (plan.entries.length === 0 && activeClosing.length === 0) {
      blockers.push(`Tidak ada mutasi pendapatan, HPP, beban, atau prive di tahun ${year}.`);
    }

    const warnings: string[] = [];
    const drafts = journals.filter(
      (e) => e.status === "draft" && e.deletedAt === null && yearOf(e.entryDate) === year,
    );
    if (drafts.length > 0) {
      warnings.push(`Ada ${drafts.length} draft jurnal bertanggal ${year} yang belum diposting dan tidak ikut ditutup.`);
    }
    const hasDecemberAdjustment = journals.some(
      (e) => isLedgerEntry(e) && e.source === "adjustment" && e.entryDate.startsWith(`${year}-12`),
    );
    if (!hasDecemberAdjustment) {
      warnings.push(`Belum ada jurnal penyesuaian (mis. stok opname) di Desember ${year}; HPP mungkin belum lengkap.`);
    }
    return { plan, activeClosing, blockers, warnings };
  }

  /** Membuat akun Ikhtisar bila perlu, lalu posting jurnal penutup & mengunci periode. */
  async close(workspaceId: string, year: number): Promise<JournalEntry[]> {
    const preview = await this.preview(workspaceId, year);
    if (preview.blockers.length > 0) fail("INVALID_CLOSING", preview.blockers.join(" "));

    let accounts = await this.deps.accounts.listByWorkspace(workspaceId);
    if (!accounts.some((a) => a.systemRole === "income_summary")) {
      const taken = accounts.some((a) => a.code === INCOME_SUMMARY_SEED.code);
      await this.deps.accounts.create(workspaceId, {
        ...INCOME_SUMMARY_SEED,
        code: taken ? `${INCOME_SUMMARY_SEED.code}-IKH` : INCOME_SUMMARY_SEED.code,
      });
      accounts = await this.deps.accounts.listByWorkspace(workspaceId);
    }
    const journals = await this.deps.journals.listByWorkspace(workspaceId);
    const plan = buildClosingPlan(workspaceId, year, accounts, journals);
    return this.deps.journals.closeFiscalYear(workspaceId, year, plan.entries);
  }

  /** Membatalkan tutup buku (seluruh paket), bertanggal 31 Desember tahun itu. */
  async cancel(workspaceId: string, year: number): Promise<JournalEntry[]> {
    const periods = await this.deps.periods.listByWorkspace(workspaceId);
    const december = periods.find((p) => p.startDate === `${year}-12-01`);
    if (december && december.status !== "open") {
      fail(
        "PERIOD_CLOSED",
        `Buka kembali periode Desember ${year} sebelum membatalkan tutup buku (pembalik bertanggal ${closingDate(year)})`,
      );
    }
    return this.deps.journals.cancelFiscalYearClosing(workspaceId, year);
  }
}

/** Untuk pratinjau: akun Ikhtisar sementara bila belum ada (dibuat saat tutup buku). */
function withIncomeSummary(workspaceId: string, accounts: Account[]): Account[] {
  if (accounts.some((a) => a.systemRole === "income_summary")) return accounts;
  return [
    ...accounts,
    {
      ...INCOME_SUMMARY_SEED,
      id: "__income_summary__",
      workspaceId,
      isActive: true,
      createdAt: "",
      updatedAt: "",
      deletedAt: null,
    },
  ];
}
