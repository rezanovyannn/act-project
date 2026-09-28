import { assertNoIssues, fail } from "@/core/errors";
import { validateForPosting, validateLineAmounts } from "@/core/journal-validation";
import { nextEntryNumber } from "@/core/numbering";
import type { IJournalRepository, JournalFilter } from "@/core/ports";
import { activeOpeningBalance } from "@/core/opening-balance";
import { validateReversal } from "@/core/reversal";
import { validateSettlement } from "@/core/settlement";
import type { JournalEntry, JournalEntryInput, JournalLine } from "@/core/types";
import type { MockDatabase, MockState } from "./mock-database";

function findActive(state: MockState, id: string): JournalEntry | undefined {
  return state.journals.find((j) => j.id === id && j.deletedAt === null);
}

function findReversal(state: MockState, id: string): JournalEntry | null {
  return (
    state.journals.find(
      (j) => j.reversalOf === id && j.status === "posted" && j.deletedAt === null,
    ) ?? null
  );
}

function activeSettlements(state: MockState, id: string): JournalEntry[] {
  return state.journals.filter(
    (j) =>
      j.settlementOf === id &&
      j.status === "posted" &&
      j.deletedAt === null &&
      findReversal(state, j.id) === null,
  );
}

function requireDraft(state: MockState, id: string): JournalEntry {
  const entry = findActive(state, id);
  if (!entry) fail("NOT_FOUND", "Jurnal tidak ditemukan");
  if (entry.status !== "draft") fail("NOT_DRAFT", "Jurnal posted bersifat immutable");
  return entry;
}

export class MockJournalRepository implements IJournalRepository {
  constructor(private readonly db: MockDatabase) {}

  async listByWorkspace(workspaceId: string, filter: JournalFilter = {}): Promise<JournalEntry[]> {
    return this.db
      .read()
      .journals.filter(
        (j) =>
          j.workspaceId === workspaceId &&
          j.deletedAt === null &&
          (!filter.status || j.status === filter.status) &&
          (!filter.fromDate || j.entryDate >= filter.fromDate) &&
          (!filter.toDate || j.entryDate <= filter.toDate),
      )
      .sort(
        (a, b) =>
          a.entryDate.localeCompare(b.entryDate) || a.createdAt.localeCompare(b.createdAt),
      );
  }

  async getById(id: string): Promise<JournalEntry | null> {
    return findActive(this.db.read(), id) ?? null;
  }

  async findReversalOf(id: string): Promise<JournalEntry | null> {
    return findReversal(this.db.read(), id);
  }

  async listActiveSettlementsOf(id: string): Promise<JournalEntry[]> {
    return activeSettlements(this.db.read(), id);
  }

  async saveDraft(input: JournalEntryInput, draftId?: string): Promise<JournalEntry> {
    assertNoIssues(validateLineAmounts(input.lines));
    return this.db.write((state) => {
      const now = this.db.now();
      const existing = draftId ? requireDraft(state, draftId) : undefined;
      const entry = this.buildEntry(input, "draft", now, existing);
      this.db.audit(state, {
        workspaceId: input.workspaceId,
        entityType: "journal",
        entityId: entry.id,
        action: existing ? "update_draft" : "create_draft",
        before: existing ?? null,
        after: entry,
      });
      if (existing) {
        Object.assign(existing, entry);
        return existing;
      }
      state.journals.push(entry);
      return entry;
    });
  }

  async deleteDraft(id: string): Promise<void> {
    this.db.write((state) => {
      const entry = requireDraft(state, id);
      entry.deletedAt = this.db.now();
      this.db.audit(state, { workspaceId: entry.workspaceId, entityType: "journal", entityId: id, action: "delete_draft", before: entry, after: null });
    });
  }

  async postJournal(input: JournalEntryInput, draftId?: string): Promise<JournalEntry> {
    return this.db.write((state) => {
      // Lapisan pertahanan terakhir, meniru RPC post_journal (ADR 008).
      const accounts = state.accounts.filter((a) => a.workspaceId === input.workspaceId);
      assertNoIssues(
        validateForPosting(input, {
          accounts,
          periods: state.periods.filter((p) => p.workspaceId === input.workspaceId),
        }),
      );
      if (input.source === "settlement" || input.settlementOf) {
        const targetId = input.settlementOf ?? null;
        assertNoIssues(
          validateSettlement(input, {
            target: targetId ? findActive(state, targetId) ?? null : null,
            targetReversed: targetId ? findReversal(state, targetId) !== null : false,
            activeSettlements: targetId ? activeSettlements(state, targetId) : [],
            accounts,
          }),
        );
      }
      if (
        input.source === "opening_balance" &&
        activeOpeningBalance(state.journals.filter((j) => j.workspaceId === input.workspaceId))
      ) {
        fail("DUPLICATE_OPENING_BALANCE", "Saldo awal sudah diposting untuk workspace ini");
      }
      if (input.reversalOf) {
        const original = findActive(state, input.reversalOf);
        if (!original || original.workspaceId !== input.workspaceId) {
          fail("NOT_FOUND", "Jurnal asal tidak ditemukan");
        }
        assertNoIssues(
          validateReversal(
            original,
            findReversal(state, original.id),
            input.entryDate,
            activeSettlements(state, original.id),
          ),
        );
      }

      const now = this.db.now();
      const existing = draftId ? requireDraft(state, draftId) : undefined;
      const entry = this.buildEntry(input, "posted", now, existing);
      entry.entryNumber = nextEntryNumber(
        state.journals
          .filter((j) => j.workspaceId === input.workspaceId)
          .map((j) => j.entryNumber),
        input.entryDate,
      );
      entry.postedAt = now;
      this.db.audit(state, {
        workspaceId: input.workspaceId,
        entityType: "journal",
        entityId: entry.id,
        action: input.reversalOf ? "reverse" : "post",
        before: existing ?? null,
        after: entry,
      });
      if (existing) {
        Object.assign(existing, entry);
        return existing;
      }
      state.journals.push(entry);
      return entry;
    });
  }

  private buildEntry(
    input: JournalEntryInput,
    status: JournalEntry["status"],
    now: string,
    existing?: JournalEntry,
  ): JournalEntry {
    const lines: JournalLine[] = input.lines.map((line, index) => ({
      id: this.db.generateId(),
      accountId: line.accountId,
      lineNo: index + 1,
      description: line.description ?? null,
      debit: line.debit,
      credit: line.credit,
    }));
    return {
      id: existing?.id ?? this.db.generateId(),
      workspaceId: input.workspaceId,
      entryNumber: null,
      entryDate: input.entryDate,
      description: input.description.trim(),
      status,
      source: input.source,
      counterparty: input.counterparty?.trim() || null,
      settlementOf: input.settlementOf ?? null,
      reversalOf: input.reversalOf ?? null,
      correctionOf: input.correctionOf ?? null,
      postedAt: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deletedAt: null,
      lines,
    };
  }
}
