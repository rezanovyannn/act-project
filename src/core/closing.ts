/**
 * Tutup buku akhir tahun (ADR 014): akun pendapatan, HPP, dan beban ditutup
 * lewat Ikhtisar Laba Rugi ke Laba Ditahan; Prive ditutup ke Laba Ditahan.
 */
import { toIsoDate } from "./dates";
import type { ValidationIssue } from "./errors";
import { isLedgerEntry } from "./ledger";
import type {
  Account,
  AccountSeed,
  IsoDate,
  JournalEntry,
  JournalEntryInput,
  JournalLineInput,
  SystemRole,
} from "./types";

export const INCOME_SUMMARY_SEED: AccountSeed = {
  code: "3-8000",
  name: "Ikhtisar Laba Rugi",
  accountType: "equity",
  normalBalance: "credit",
  cashFlowCategory: "none",
  isCash: false,
  systemRole: "income_summary",
};

export const closingDate = (year: number): IsoDate => toIsoDate(year, 12, 31);

// ------------------------------------------------------------ jurnal penutup

/** Id jurnal penutup (posted) di daftar jurnal. */
function closingIds(entries: readonly JournalEntry[]): Set<string> {
  return new Set(entries.filter((e) => isLedgerEntry(e) && e.source === "closing").map((e) => e.id));
}

/** `true` bila jurnal adalah jurnal penutup atau pembalik jurnal penutup. */
export function isClosingRelated(entry: JournalEntry, ids: ReadonlySet<string>): boolean {
  return entry.source === "closing" || (entry.reversalOf !== null && ids.has(entry.reversalOf));
}

/**
 * Jurnal tanpa jurnal penutup & pembaliknya. Dipakai laporan mutasi laba rugi,
 * dashboard, dan setoran modal/prive (ADR 014).
 */
export function withoutClosing(entries: readonly JournalEntry[]): JournalEntry[] {
  const ids = closingIds(entries);
  return entries.filter((e) => !isClosingRelated(e, ids));
}

/** Jurnal penutup yang masih berlaku (belum dibatalkan) untuk tahun buku. */
export function activeClosingEntries(entries: readonly JournalEntry[], year: number): JournalEntry[] {
  const posted = entries.filter(isLedgerEntry);
  const reversed = new Set(posted.map((e) => e.reversalOf).filter(Boolean));
  const date = closingDate(year);
  return posted.filter((e) => e.source === "closing" && e.entryDate === date && !reversed.has(e.id));
}

// --------------------------------------------------------------- rencana

export interface ClosingPlan {
  year: number;
  date: IsoDate;
  entries: JournalEntryInput[];
  revenue: number;
  cogs: number;
  expenses: number;
  netIncome: number;
  drawings: number;
}

/** Mutasi debit − kredit per akun selama tahun buku (tanpa jurnal penutup). */
function yearMovement(entries: readonly JournalEntry[], year: number): Map<string, number> {
  const from = toIsoDate(year, 1, 1);
  const to = closingDate(year);
  const net = new Map<string, number>();
  for (const entry of withoutClosing(entries)) {
    if (!isLedgerEntry(entry) || entry.entryDate < from || entry.entryDate > to) continue;
    for (const line of entry.lines) {
      net.set(line.accountId, (net.get(line.accountId) ?? 0) + line.debit - line.credit);
    }
  }
  return net;
}

/**
 * Menolkan akun-akun (`nets` = debit − kredit) ke satu akun lawan.
 * Mengembalikan null bila tidak ada mutasi yang perlu ditutup.
 */
function closeInto(
  nets: readonly { accountId: string; net: number }[],
  counterpartId: string,
): JournalLineInput[] | null {
  const lines: JournalLineInput[] = nets
    .filter((n) => n.net !== 0)
    .map((n) => (n.net > 0 ? { accountId: n.accountId, debit: 0, credit: n.net } : { accountId: n.accountId, debit: -n.net, credit: 0 }));
  if (lines.length === 0) return null;
  const total = nets.reduce((sum, n) => sum + n.net, 0);
  if (total > 0) lines.push({ accountId: counterpartId, debit: total, credit: 0 });
  if (total < 0) lines.push({ accountId: counterpartId, debit: 0, credit: -total });
  return lines.length >= 2 ? lines : null;
}

function roleAccount(accounts: readonly Account[], role: SystemRole): Account | undefined {
  return accounts.find((a) => a.systemRole === role && a.deletedAt === null);
}

/**
 * Rencana tutup buku: maksimal 4 jurnal penutup bertanggal 31 Desember.
 * Membutuhkan akun Ikhtisar Laba Rugi, Laba Ditahan, dan Prive.
 */
export function buildClosingPlan(
  workspaceId: string,
  year: number,
  accounts: readonly Account[],
  entries: readonly JournalEntry[],
): ClosingPlan {
  const summary = roleAccount(accounts, "income_summary");
  const retained = roleAccount(accounts, "retained_earnings");
  if (!summary || !retained) {
    throw new Error("Akun Ikhtisar Laba Rugi dan Laba Ditahan wajib ada untuk tutup buku");
  }
  const movement = yearMovement(entries, year);
  const netsOf = (predicate: (a: Account) => boolean) =>
    accounts.filter(predicate).map((a) => ({ accountId: a.id, net: movement.get(a.id) ?? 0 }));

  const revenueNets = netsOf((a) => a.accountType === "revenue");
  const costNets = netsOf((a) => a.accountType === "cogs" || a.accountType === "expense");
  const drawingNets = netsOf((a) => a.systemRole === "drawings");
  const sum = (nets: { net: number }[]) => nets.reduce((total, n) => total + n.net, 0);

  const date = closingDate(year);
  const make = (description: string, lines: JournalLineInput[] | null): JournalEntryInput[] =>
    lines ? [{ workspaceId, entryDate: date, description, source: "closing", lines }] : [];

  const summaryNet = sum(revenueNets) + sum(costNets);
  const entriesToPost = [
    ...make(`Penutupan akun pendapatan ${year}`, closeInto(revenueNets, summary.id)),
    ...make(`Penutupan akun HPP dan beban ${year}`, closeInto(costNets, summary.id)),
    ...make(`Penutupan Ikhtisar Laba Rugi ${year} ke Laba Ditahan`, closeInto([{ accountId: summary.id, net: summaryNet }], retained.id)),
    ...make(`Penutupan Prive ${year} ke Laba Ditahan`, closeInto(drawingNets, retained.id)),
  ];

  const revenue = -sum(revenueNets);
  const costs = accounts.filter((a) => a.accountType === "cogs").reduce((t, a) => t + (movement.get(a.id) ?? 0), 0);
  const expenses = accounts.filter((a) => a.accountType === "expense").reduce((t, a) => t + (movement.get(a.id) ?? 0), 0);
  return {
    year,
    date,
    entries: entriesToPost,
    revenue,
    cogs: costs,
    expenses,
    netIncome: revenue - costs - expenses,
    drawings: sum(drawingNets),
  };
}

/**
 * Validasi hasil tutup buku (dipakai repository sebagai pertahanan terakhir):
 * setelah jurnal penutup, mutasi tahun itu pada akun nominal & Prive = 0 dan
 * saldo Ikhtisar Laba Rugi = 0.
 */
export function validateClosingResult(
  year: number,
  accounts: readonly Account[],
  entriesAfter: readonly JournalEntry[],
): ValidationIssue[] {
  const from = toIsoDate(year, 1, 1);
  const to = closingDate(year);
  const movement = new Map<string, number>();
  const balance = new Map<string, number>();
  for (const entry of entriesAfter) {
    if (!isLedgerEntry(entry)) continue;
    for (const line of entry.lines) {
      const delta = line.debit - line.credit;
      balance.set(line.accountId, (balance.get(line.accountId) ?? 0) + delta);
      if (entry.entryDate >= from && entry.entryDate <= to) {
        movement.set(line.accountId, (movement.get(line.accountId) ?? 0) + delta);
      }
    }
  }
  const unclosed = accounts.filter(
    (a) =>
      ((["revenue", "cogs", "expense"] as string[]).includes(a.accountType) || a.systemRole === "drawings") &&
      (movement.get(a.id) ?? 0) !== 0,
  );
  const summary = roleAccount(accounts, "income_summary");
  const issues: ValidationIssue[] = unclosed.map((a) => ({
    code: "INVALID_CLOSING",
    message: `Akun ${a.code} ${a.name} belum bersaldo nol setelah tutup buku ${year}`,
  }));
  if (summary && (balance.get(summary.id) ?? 0) !== 0) {
    issues.push({ code: "INVALID_CLOSING", message: "Ikhtisar Laba Rugi belum bersaldo nol setelah tutup buku" });
  }
  return issues;
}
