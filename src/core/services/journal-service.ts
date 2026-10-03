import { assertNoIssues, fail } from "../errors";
import { validateForPosting, validateLineAmounts } from "../journal-validation";
import { activeOpeningBalance } from "../opening-balance";
import type {
  IAccountRepository,
  IItemRepository,
  IJournalRepository,
  IPeriodRepository,
} from "../ports";
import { validateReturn } from "../returns";
import { buildReversalInput, validateReversal } from "../reversal";
import { validateSettlement, type SettlementContext } from "../settlement";
import type { Account, IsoDate, JournalEntry, JournalEntryInput } from "../types";

export interface JournalServiceDeps {
  journals: IJournalRepository;
  accounts: IAccountRepository;
  periods: IPeriodRepository;
  items: IItemRepository;
}

export interface CorrectionResult {
  reversal: JournalEntry;
  draft: JournalEntry;
}

/** Siklus hidup jurnal: draft → posted → (void | koreksi). ADR 008 & 009. */
export class JournalService {
  constructor(private readonly deps: JournalServiceDeps) {}

  async saveDraft(input: JournalEntryInput, draftId?: string): Promise<JournalEntry> {
    if (draftId) await this.requireDraft(draftId);
    assertNoIssues(validateLineAmounts(input.lines));
    return this.deps.journals.saveDraft(
      { ...input, reversalOf: null },
      draftId,
    );
  }

  async deleteDraft(draftId: string): Promise<void> {
    await this.requireDraft(draftId);
    await this.deps.journals.deleteDraft(draftId);
  }

  /**
   * Memposting jurnal baru, atau draft bila `draftId` diberikan.
   * Jurnal pembalik hanya dibuat lewat `voidJournal`/`correctJournal`.
   */
  async postJournal(input: JournalEntryInput, draftId?: string): Promise<JournalEntry> {
    if (input.source === "closing") {
      fail("INVALID_CLOSING", "Jurnal penutup dibuat lewat fitur Tutup Buku");
    }
    if (input.source === "reversal" || input.reversalOf) {
      fail("INVALID_REVERSAL", "Jurnal pembalik dibuat lewat fitur Void atau Koreksi");
    }
    if (draftId) await this.requireDraft(draftId);
    return this.validateAndPost(input, draftId);
  }

  async postDraft(draftId: string): Promise<JournalEntry> {
    const draft = await this.requireDraft(draftId);
    return this.postJournal(toInput(draft), draftId);
  }

  /** Void: satu jurnal pembalik bertanggal di periode open. */
  async voidJournal(
    entryId: string,
    reversalDate: IsoDate,
    description?: string,
  ): Promise<JournalEntry> {
    const original = await this.requireEntry(entryId);
    const [existingReversal, activeSettlements, activeReturns] = await Promise.all([
      this.deps.journals.findReversalOf(entryId),
      this.deps.journals.listActiveSettlementsOf(entryId),
      this.deps.journals.listActiveReturnsOf(entryId),
    ]);
    assertNoIssues(
      validateReversal(original, existingReversal, reversalDate, activeSettlements, activeReturns),
    );
    return this.validateAndPost(
      buildReversalInput(original, reversalDate, description),
    );
  }

  /** Koreksi: jurnal pembalik + draft baru salinan jurnal asal. */
  async correctJournal(entryId: string, reversalDate: IsoDate): Promise<CorrectionResult> {
    const original = await this.requireEntry(entryId);
    const label = original.entryNumber ?? original.id;
    const reversal = await this.voidJournal(
      entryId,
      reversalDate,
      `Pembalik untuk koreksi ${label}: ${original.description}`,
    );
    const draft = await this.deps.journals.saveDraft({
      ...toInput(original),
      entryDate: reversalDate,
      reversalOf: null,
      correctionOf: original.id,
    });
    return { reversal, draft };
  }

  private async validateAndPost(
    input: JournalEntryInput,
    draftId?: string,
  ): Promise<JournalEntry> {
    await this.validateForPosting(input);
    return this.deps.journals.postJournal(input, draftId);
  }

  /**
   * Validasi posting tanpa menyimpan (periode, akun, keseimbangan, retur,
   * pelunasan, saldo awal). Dipakai alur yang menyimpan jurnal bersama data
   * lain secara atomik di repository, mis. penjualan menu (ADR 021).
   */
  async validateForPosting(input: JournalEntryInput): Promise<void> {
    const [accounts, periods, items] = await Promise.all([
      this.deps.accounts.listByWorkspace(input.workspaceId),
      this.deps.periods.listByWorkspace(input.workspaceId),
      this.deps.items.listByWorkspace(input.workspaceId),
    ]);
    const issues = validateForPosting(input, { accounts, periods, items });
    if (input.returnOf) {
      const [target, reversal, activeReturns] = await Promise.all([
        this.deps.journals.getById(input.returnOf),
        this.deps.journals.findReversalOf(input.returnOf),
        this.deps.journals.listActiveReturnsOf(input.returnOf),
      ]);
      issues.push(...validateReturn(input, { target, targetReversed: reversal !== null, activeReturns, accounts }));
    }
    if (input.source === "settlement" || input.settlementOf) {
      const context = await this.settlementContext(input.settlementOf ?? null, accounts);
      issues.push(...validateSettlement(input, context));
    }
    if (input.source === "opening_balance") {
      const existing = activeOpeningBalance(await this.deps.journals.listByWorkspace(input.workspaceId));
      if (existing) {
        issues.push({
          code: "DUPLICATE_OPENING_BALANCE",
          message: `Saldo awal sudah diposting (${existing.entryNumber}); void jurnal tersebut untuk membuat ulang`,
        });
      }
    }
    assertNoIssues(issues);
  }

  private async settlementContext(
    targetId: string | null,
    accounts: Account[],
  ): Promise<SettlementContext> {
    if (!targetId) {
      return { target: null, targetReversed: false, activeSettlements: [], accounts };
    }
    const [target, reversal, activeSettlements] = await Promise.all([
      this.deps.journals.getById(targetId),
      this.deps.journals.findReversalOf(targetId),
      this.deps.journals.listActiveSettlementsOf(targetId),
    ]);
    return { target, targetReversed: reversal !== null, activeSettlements, accounts };
  }

  private async requireEntry(id: string): Promise<JournalEntry> {
    const entry = await this.deps.journals.getById(id);
    if (!entry || entry.deletedAt !== null) {
      fail("NOT_FOUND", "Jurnal tidak ditemukan");
    }
    return entry;
  }

  private async requireDraft(id: string): Promise<JournalEntry> {
    const entry = await this.requireEntry(id);
    if (entry.status !== "draft") {
      fail("NOT_DRAFT", "Jurnal posted tidak dapat diubah atau dihapus; gunakan Void atau Koreksi");
    }
    return entry;
  }
}

function toInput(entry: JournalEntry): JournalEntryInput {
  return {
    workspaceId: entry.workspaceId,
    entryDate: entry.entryDate,
    description: entry.description,
    source: entry.source,
    counterparty: entry.counterparty,
    settlementOf: entry.settlementOf,
    reversalOf: entry.reversalOf,
    correctionOf: entry.correctionOf,
    returnOf: entry.returnOf,
    lines: entry.lines.map((line) => ({
      accountId: line.accountId,
      description: line.description,
      debit: line.debit,
      credit: line.credit,
      itemId: line.itemId,
      quantity: line.quantity,
    })),
  };
}
