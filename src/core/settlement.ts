/**
 * Pelunasan piutang/utang (ADR 012). Sisa tagihan dihitung dari baris akun
 * Piutang Usaha / Utang Usaha pada jurnal asal dikurangi pelunasan aktif.
 */
import type { ValidationIssue } from "./errors";
import { formatRupiah } from "./money";
import type { Account, JournalEntry, JournalEntryInput, JournalLineInput } from "./types";

type AccountLookup = ReadonlyMap<string, Pick<Account, "systemRole">>;

/**
 * Nilai baris terhadap saldo tagihan: + menambah tagihan, − mengurangi.
 * Piutang bertambah di debit; utang bertambah di kredit.
 */
function claimEffect(line: JournalLineInput, accounts: AccountLookup): number {
  const role = accounts.get(line.accountId)?.systemRole;
  if (role === "accounts_receivable") return line.debit - line.credit;
  if (role === "accounts_payable") return line.credit - line.debit;
  return 0;
}

function claimTotal(lines: readonly JournalLineInput[], accounts: AccountLookup): number {
  return lines.reduce((sum, line) => sum + claimEffect(line, accounts), 0);
}

/** Sisa tagihan jurnal kredit setelah pelunasan aktif (yang belum di-void). */
export function outstandingAmount(
  target: JournalEntry,
  activeSettlements: readonly JournalEntry[],
  accounts: AccountLookup,
): number {
  const settled = activeSettlements.reduce(
    (sum, settlement) => sum - claimTotal(settlement.lines, accounts),
    0,
  );
  return claimTotal(target.lines, accounts) - settled;
}

export interface SettlementContext {
  target: JournalEntry | null;
  targetReversed: boolean;
  activeSettlements: readonly JournalEntry[];
  accounts: readonly Account[];
}

/**
 * Syarat jurnal pelunasan: `source = settlement`, target jurnal kredit posted
 * yang belum di-void di workspace yang sama, mengurangi piutang/utang target,
 * dan tidak melebihi sisa tagihan.
 */
export function validateSettlement(
  entry: JournalEntryInput,
  context: SettlementContext,
): ValidationIssue[] {
  const invalid = (message: string): ValidationIssue[] => [
    { code: "INVALID_SETTLEMENT", message },
  ];
  const { target } = context;

  if (entry.source !== "settlement") {
    return invalid("Jurnal pelunasan harus bersumber 'settlement'");
  }
  if (
    !target ||
    target.deletedAt !== null ||
    target.status !== "posted" ||
    target.workspaceId !== entry.workspaceId
  ) {
    return invalid("Transaksi yang dilunasi tidak ditemukan");
  }
  if (context.targetReversed) {
    return invalid("Transaksi yang dilunasi sudah di-void");
  }

  const accounts = new Map(context.accounts.map((a) => [a.id, a]));
  const outstanding = outstandingAmount(target, context.activeSettlements, accounts);
  if (claimTotal(target.lines, accounts) <= 0) {
    return invalid("Transaksi yang dilunasi bukan transaksi kredit (tidak ada piutang/utang usaha)");
  }

  const targetClaimAccounts = new Set(
    target.lines.filter((l) => claimEffect(l, accounts) !== 0).map((l) => l.accountId),
  );
  const payment = -claimTotal(
    entry.lines.filter((l) => targetClaimAccounts.has(l.accountId)),
    accounts,
  );
  if (payment <= 0) {
    return invalid("Jurnal pelunasan harus mengurangi piutang/utang usaha transaksi asal");
  }
  if (payment > outstanding) {
    return invalid(
      `Pelunasan ${formatRupiah(payment)} melebihi sisa tagihan ${formatRupiah(outstanding)}`,
    );
  }
  return [];
}

export interface CreditTransaction {
  entry: JournalEntry;
  kind: "receivable" | "payable";
  counterparty: string | null;
  /** Nominal piutang/utang awal. */
  original: number;
  paid: number;
  outstanding: number;
  /** Pelunasan aktif (belum di-void), urut tanggal. */
  settlements: JournalEntry[];
}

/**
 * Semua transaksi kredit posted yang belum di-void beserta sisa tagihannya
 * (ADR 012). Filter `outstanding > 0` untuk daftar yang belum lunas.
 */
export function listCreditTransactions(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
): CreditTransaction[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const posted = entries.filter((e) => e.status === "posted" && e.deletedAt === null);
  const reversed = new Set(posted.filter((e) => e.reversalOf).map((e) => e.reversalOf!));
  const active = posted.filter((e) => !reversed.has(e.id) && e.source !== "reversal");

  const result: CreditTransaction[] = [];
  for (const entry of active) {
    if (entry.source === "settlement") continue;
    const original = claimTotal(entry.lines, byId);
    if (original <= 0) continue;
    const receivable = entry.lines.some(
      (l) => byId.get(l.accountId)?.systemRole === "accounts_receivable",
    );
    const settlements = active
      .filter((s) => s.settlementOf === entry.id)
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate));
    const outstanding = outstandingAmount(entry, settlements, byId);
    result.push({
      entry,
      kind: receivable ? "receivable" : "payable",
      counterparty: entry.counterparty,
      original,
      paid: original - outstanding,
      outstanding,
      settlements,
    });
  }
  return result.sort((a, b) => a.entry.entryDate.localeCompare(b.entry.entryDate));
}
