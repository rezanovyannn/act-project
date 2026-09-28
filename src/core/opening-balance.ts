/**
 * Saldo awal pembukuan (ROADMAP 1E): satu jurnal `opening_balance` atomik,
 * selisih debit/kredit ke akun Ekuitas Saldo Awal.
 */
import { fail } from "./errors";
import { isValidAmount } from "./money";
import { accountByRole } from "./transactions";
import type { Account, IsoDate, JournalEntry, JournalEntryInput, JournalLineInput } from "./types";

export interface OpeningBalanceItem {
  accountId: string;
  /** Saldo menurut saldo normal akun (mis. Akumulasi Penyusutan diisi positif). */
  amount: number;
}

export interface OpeningBalanceResult {
  entry: JournalEntryInput;
  totalDebit: number;
  totalCredit: number;
  /** Positif = Ekuitas Saldo Awal di kredit, negatif = di debit. */
  equityDifference: number;
}

const BALANCE_SHEET_TYPES = new Set(["asset", "liability", "equity"]);

export function buildOpeningBalance(
  input: { workspaceId: string; entryDate: IsoDate; items: OpeningBalanceItem[]; description?: string },
  accounts: readonly Account[],
): OpeningBalanceResult {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const equityAccount = accountByRole(accounts, "opening_balance_equity");
  const lines: JournalLineInput[] = [];

  for (const item of input.items) {
    if (!isValidAmount(item.amount)) {
      fail("INVALID_AMOUNT", "Saldo awal harus bilangan bulat Rupiah tidak negatif");
    }
    if (item.amount === 0) continue;
    const account = byId.get(item.accountId);
    if (!account || !BALANCE_SHEET_TYPES.has(account.accountType)) {
      fail("INVALID_ACCOUNT", "Saldo awal hanya untuk akun neraca (aset, liabilitas, ekuitas)");
    }
    if (account.id === equityAccount.id) {
      fail("INVALID_ACCOUNT", `${account.name} diisi otomatis dari selisih`);
    }
    lines.push(
      account.normalBalance === "debit"
        ? { accountId: account.id, debit: item.amount, credit: 0 }
        : { accountId: account.id, debit: 0, credit: item.amount },
    );
  }
  if (lines.length === 0) fail("LINE_ZERO", "Isi minimal satu saldo awal");

  const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
  const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
  const equityDifference = totalDebit - totalCredit;
  if (equityDifference !== 0) {
    lines.push({
      accountId: equityAccount.id,
      description: "Selisih saldo awal",
      debit: equityDifference < 0 ? -equityDifference : 0,
      credit: equityDifference > 0 ? equityDifference : 0,
    });
  }

  return {
    entry: {
      workspaceId: input.workspaceId,
      entryDate: input.entryDate,
      description: input.description?.trim() || "Saldo awal pembukuan",
      source: "opening_balance",
      lines,
    },
    totalDebit,
    totalCredit,
    equityDifference,
  };
}

/** Jurnal saldo awal yang masih berlaku (posted dan belum di-void). */
export function activeOpeningBalance(entries: readonly JournalEntry[]): JournalEntry | null {
  const posted = entries.filter((e) => e.status === "posted" && e.deletedAt === null);
  const reversed = new Set(posted.map((e) => e.reversalOf).filter(Boolean));
  return posted.find((e) => e.source === "opening_balance" && !reversed.has(e.id)) ?? null;
}
