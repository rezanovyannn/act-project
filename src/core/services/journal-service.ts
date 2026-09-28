import { assertNoIssues, fail } from "../errors";
import { validateForPosting, validateLineAmounts } from "../journal-validation";
import type {
  IAccountRepository,
  IJournalRepository,
  IPeriodRepository,
} from "../ports";
import { buildReversalInput, validateReversal } from "../reversal";
import type { IsoDate, JournalEntry, JournalEntryInput } from "../types";

export interface JournalServiceDeps {
  journals: IJournalRepository;
  accounts: IAccountRepository;
  periods: IPeriodRepository;
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
    const existingReversal = await this.deps.journals.findReversalOf(entryId);
    assertNoIssues(validateReversal(original, existingReversal, reversalDate));
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
    const [accounts, periods] = await Promise.all([
      this.deps.accounts.listByWorkspace(input.workspaceId),
      this.deps.periods.listByWorkspace(input.workspaceId),
    ]);
    assertNoIssues(validateForPosting(input, { accounts, periods }));
    return this.deps.journals.postJournal(input, draftId);
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
    reversalOf: entry.reversalOf,
    correctionOf: entry.correctionOf,
    lines: entry.lines.map((line) => ({
      accountId: line.accountId,
      description: line.description,
      debit: line.debit,
      credit: line.credit,
    })),
  };
}
