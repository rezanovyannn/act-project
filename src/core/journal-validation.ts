import { isValidIsoDate } from "./dates";
import type { ValidationIssue } from "./errors";
import { formatRupiah, isValidAmount } from "./money";
import { findPeriodForDate } from "./periods";
import type {
  Account,
  Item,
  JournalEntryInput,
  JournalLineInput,
  Period,
} from "./types";

/**
 * Validasi nominal per baris. Dipakai juga untuk draft: draft boleh belum
 * balance, tetapi nominalnya tetap harus integer aman non-negatif.
 */
export function validateLineAmounts(
  lines: readonly JournalLineInput[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  lines.forEach((line, lineIndex) => {
    if (!isValidAmount(line.debit) || !isValidAmount(line.credit)) {
      issues.push({
        code: "INVALID_AMOUNT",
        message: `Baris ${lineIndex + 1}: nominal harus bilangan bulat Rupiah tidak negatif`,
        lineIndex,
      });
    } else if (line.debit > 0 && line.credit > 0) {
      issues.push({
        code: "LINE_BOTH_SIDES",
        message: `Baris ${lineIndex + 1}: isi debit ATAU kredit, tidak keduanya`,
        lineIndex,
      });
    }
  });
  return issues;
}

/**
 * Aturan double-entry untuk jurnal yang akan diposting:
 * minimal 2 baris, tiap baris tepat satu sisi > 0, dan total debit = kredit.
 */
export function validateBalancedLines(
  lines: readonly JournalLineInput[],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (lines.length < 2) {
    issues.push({
      code: "TOO_FEW_LINES",
      message: "Jurnal minimal terdiri dari 2 baris",
    });
  }

  const amountIssues = validateLineAmounts(lines);
  issues.push(...amountIssues);

  lines.forEach((line, lineIndex) => {
    if (line.debit === 0 && line.credit === 0) {
      issues.push({
        code: "LINE_ZERO",
        message: `Baris ${lineIndex + 1}: nominal debit atau kredit harus lebih dari 0`,
        lineIndex,
      });
    }
  });

  if (amountIssues.length > 0) return issues;

  let totalDebit = 0;
  let totalCredit = 0;
  for (const line of lines) {
    totalDebit += line.debit;
    totalCredit += line.credit;
  }
  if (!Number.isSafeInteger(totalDebit) || !Number.isSafeInteger(totalCredit)) {
    issues.push({
      code: "AMOUNT_OVERFLOW",
      message: "Total jurnal melewati batas nilai yang didukung",
    });
  } else if (totalDebit !== totalCredit) {
    issues.push({
      code: "UNBALANCED",
      message: `Total debit (${formatRupiah(totalDebit)}) tidak sama dengan total kredit (${formatRupiah(totalCredit)})`,
    });
  }
  return issues;
}

export interface PostingContext {
  accounts: readonly Account[];
  periods: readonly Period[];
  /** Barang workspace; wajib bila ada baris ber-barang (ADR 017). */
  items?: readonly Item[];
}

/**
 * Baris ber-barang (ADR 017): qty bilangan bulat ≥ 0 hanya bersama barang,
 * barang ada di workspace yang sama, dan aktif (kecuali jurnal pembalik).
 */
export function validateItemLines(
  entry: JournalEntryInput,
  items: readonly Item[] = [],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const itemsById = new Map(items.map((i) => [i.id, i]));
  entry.lines.forEach((line, lineIndex) => {
    const where = `Baris ${lineIndex + 1}`;
    if (!line.itemId) {
      if (line.quantity !== undefined && line.quantity !== null) {
        issues.push({ code: "INVALID_QUANTITY", message: `${where}: kuantitas hanya untuk baris barang`, lineIndex });
      }
      return;
    }
    const qty = line.quantity;
    if (typeof qty !== "number" || !Number.isSafeInteger(qty) || qty < 0) {
      issues.push({ code: "INVALID_QUANTITY", message: `${where}: kuantitas harus bilangan bulat tidak negatif`, lineIndex });
    }
    const item = itemsById.get(line.itemId);
    if (!item || item.deletedAt !== null || item.workspaceId !== entry.workspaceId) {
      issues.push({ code: "ITEM_NOT_FOUND", message: `${where}: barang tidak ditemukan`, lineIndex });
    } else if (!item.isActive && entry.source !== "reversal") {
      issues.push({ code: "ITEM_INACTIVE", message: `${where}: barang ${item.code} ${item.name} sudah nonaktif`, lineIndex });
    }
  });
  return issues;
}

/**
 * Validasi lengkap sebelum posting (ADR 008 & 009): tanggal, keterangan,
 * double-entry, akun (ada, satu workspace, aktif), dan periode terbuka.
 * Akun nonaktif diizinkan hanya untuk jurnal pembalik.
 */
export function validateForPosting(
  entry: JournalEntryInput,
  context: PostingContext,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!isValidIsoDate(entry.entryDate)) {
    issues.push({
      code: "INVALID_DATE",
      message: "Tanggal jurnal tidak valid (format YYYY-MM-DD)",
    });
  }
  if (entry.description.trim() === "") {
    issues.push({
      code: "EMPTY_DESCRIPTION",
      message: "Keterangan jurnal wajib diisi",
    });
  }

  issues.push(...validateBalancedLines(entry.lines));
  issues.push(...validateItemLines(entry, context.items));

  const accountsById = new Map(context.accounts.map((a) => [a.id, a]));
  entry.lines.forEach((line, lineIndex) => {
    const account = accountsById.get(line.accountId);
    if (!account || account.deletedAt !== null) {
      issues.push({
        code: "ACCOUNT_NOT_FOUND",
        message: `Baris ${lineIndex + 1}: akun tidak ditemukan`,
        lineIndex,
      });
    } else if (account.workspaceId !== entry.workspaceId) {
      issues.push({
        code: "ACCOUNT_OTHER_WORKSPACE",
        message: `Baris ${lineIndex + 1}: akun bukan milik workspace ini`,
        lineIndex,
      });
    } else if (!account.isActive && entry.source !== "reversal") {
      issues.push({
        code: "ACCOUNT_INACTIVE",
        message: `Baris ${lineIndex + 1}: akun ${account.code} ${account.name} sudah nonaktif`,
        lineIndex,
      });
    }
  });

  if (isValidIsoDate(entry.entryDate)) {
    const workspacePeriods = context.periods.filter(
      (p) => p.workspaceId === entry.workspaceId,
    );
    const period = findPeriodForDate(workspacePeriods, entry.entryDate);
    if (!period) {
      issues.push({
        code: "PERIOD_NOT_FOUND",
        message: `Belum ada periode akuntansi untuk tanggal ${entry.entryDate}`,
      });
    } else if (period.status !== "open") {
      issues.push({
        code: "PERIOD_CLOSED",
        message: `Periode ${period.startDate} s.d. ${period.endDate} sudah dikunci`,
      });
    }
  }

  return issues;
}
