import { fail } from "../errors";
import type { IAccountRepository, IJournalRepository, IWorkspaceRepository } from "../ports";
import { assertValidTaxSettings, type WorkspaceTaxSettings } from "../sales-tax";
import type { Account, IsoDate, JournalEntry, Workspace } from "../types";
import { buildVatTransition, VAT_ACCOUNT_SEEDS, vatBalances } from "../vat";
import type { JournalService } from "./journal-service";

/** Cara menangani saldo PPN Masukan saat keluar dari mode PPN lengkap (ADR 016). */
export type TaxModeTransition =
  | { kind: "forward" }
  | { kind: "expense_input_vat"; entryDate: IsoDate };

export interface TaxSettingsResult {
  workspace: Workspace;
  /** Jurnal transisi yang diposting, bila ada. */
  transitionEntry: JournalEntry | null;
}

/** Pengaturan pajak penjualan & PPN lengkap (ADR 012, 015 & 016). */
export class TaxService {
  constructor(
    private readonly deps: {
      workspaces: IWorkspaceRepository;
      accounts: IAccountRepository;
      journals: IJournalRepository;
      journalService: JournalService;
    },
  ) {}

  /** Saldo PPN Masukan per tanggal (0 bila akunnya belum ada). */
  async inputVatBalance(workspaceId: string, asOf: IsoDate): Promise<number> {
    const [accounts, journals] = await Promise.all([
      this.deps.accounts.listByWorkspace(workspaceId),
      this.deps.journals.listByWorkspace(workspaceId, { status: "posted" }),
    ]);
    if (!accounts.some((a) => a.systemRole === "input_vat")) return 0;
    return vatBalances(journals, accounts, asOf).input;
  }

  /**
   * Menyimpan pengaturan pajak. Mode PPN lengkap membuat akun PPN Masukan &
   * beban PPN tidak dapat dikreditkan bila belum ada. Keluar dari mode PPN
   * lengkap dengan `expense_input_vat` memposting jurnal transisi lebih dulu.
   */
  async updateSettings(
    workspaceId: string,
    settings: WorkspaceTaxSettings,
    transition: TaxModeTransition = { kind: "forward" },
  ): Promise<TaxSettingsResult> {
    assertValidTaxSettings(settings);
    const current = await this.deps.workspaces.getById(workspaceId);
    if (!current) fail("NOT_FOUND", "Workspace tidak ditemukan");

    if (settings.mode === "full_vat") await this.ensureVatAccounts(workspaceId);

    let transitionEntry: JournalEntry | null = null;
    const leavingFullVat = current.salesTaxMode === "full_vat" && settings.mode !== "full_vat";
    if (leavingFullVat && transition.kind === "expense_input_vat") {
      const accounts = await this.deps.accounts.listByWorkspace(workspaceId);
      const balance = await this.inputVatBalance(workspaceId, transition.entryDate);
      const entry = buildVatTransition({ workspaceId, entryDate: transition.entryDate, inputVatBalance: balance }, accounts);
      if (entry) transitionEntry = await this.deps.journalService.postJournal(entry);
    }

    const workspace = await this.deps.workspaces.updateSalesTaxSettings(workspaceId, settings);
    return { workspace, transitionEntry };
  }

  /** Membuat akun sistem PPN yang belum ada; kode dicari yang masih kosong. */
  async ensureVatAccounts(workspaceId: string): Promise<Account[]> {
    let accounts = await this.deps.accounts.listByWorkspace(workspaceId);
    for (const seed of VAT_ACCOUNT_SEEDS) {
      if (accounts.some((a) => a.systemRole === seed.systemRole)) continue;
      const codes = new Set(accounts.map((a) => a.code));
      let code = seed.code;
      for (let i = 1; codes.has(code); i++) code = `${seed.code}-${i}`;
      await this.deps.accounts.create(workspaceId, { ...seed, code });
      accounts = await this.deps.accounts.listByWorkspace(workspaceId);
    }
    return accounts;
  }
}
