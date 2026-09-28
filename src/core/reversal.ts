import type { ValidationIssue } from "./errors";
import type {
  IsoDate,
  JournalEntry,
  JournalEntryInput,
  JournalLineInput,
} from "./types";

/** Baris pembalik: debit dan kredit ditukar (ADR 009). */
export function reverseLines(entry: JournalEntry): JournalLineInput[] {
  return entry.lines.map((line) => ({
    accountId: line.accountId,
    description: line.description,
    debit: line.credit,
    credit: line.debit,
  }));
}

export function buildReversalInput(
  original: JournalEntry,
  reversalDate: IsoDate,
  description?: string,
): JournalEntryInput {
  const label = original.entryNumber ?? original.id;
  return {
    workspaceId: original.workspaceId,
    entryDate: reversalDate,
    description: description?.trim() || `Pembalik ${label}: ${original.description}`,
    source: "reversal",
    reversalOf: original.id,
    correctionOf: null,
    lines: reverseLines(original),
  };
}

/**
 * Syarat sebuah jurnal boleh dibalik: sudah posted, bukan jurnal pembalik,
 * belum pernah dibalik, dan tanggal pembalik tidak sebelum tanggal asal.
 */
export function validateReversal(
  original: JournalEntry,
  existingReversal: JournalEntry | null,
  reversalDate: IsoDate,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (original.status !== "posted" || original.deletedAt !== null) {
    issues.push({
      code: "NOT_POSTED",
      message: "Hanya jurnal posted yang dapat di-void atau dikoreksi",
    });
  }
  if (original.source === "reversal") {
    issues.push({
      code: "INVALID_REVERSAL",
      message: "Jurnal pembalik tidak dapat di-void atau dikoreksi; buat jurnal baru",
    });
  }
  if (existingReversal) {
    issues.push({
      code: "ALREADY_REVERSED",
      message: `Jurnal ini sudah dibalik oleh ${existingReversal.entryNumber ?? existingReversal.id}`,
    });
  }
  if (reversalDate < original.entryDate) {
    issues.push({
      code: "INVALID_REVERSAL",
      message: "Tanggal jurnal pembalik tidak boleh sebelum tanggal jurnal asal",
    });
  }
  return issues;
}

/** Id jurnal yang sudah dibalik (status "Di-void" diturunkan, ADR 009). */
export function reversedEntryIds(entries: readonly JournalEntry[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of entries) {
    if (entry.status === "posted" && entry.deletedAt === null && entry.reversalOf) {
      ids.add(entry.reversalOf);
    }
  }
  return ids;
}
