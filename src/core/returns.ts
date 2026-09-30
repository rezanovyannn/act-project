/**
 * Retur penjualan & pembelian barang (ADR 017) dengan nilai pokok transaksi
 * asal. Retur yang mengurangi tagihan dicatat sebagai pelunasan (ADR 012).
 */
import type { ValidationIssue } from "./errors";
import { fail } from "./errors";
import { isLedgerEntry } from "./ledger";
import { mulDivRound } from "./stock";
import { accountByRole } from "./transactions";
import type { Account, IsoDate, JournalEntry, JournalEntryInput, JournalLineInput, SystemRole } from "./types";

export type ReturnKind = "sales" | "purchase";

export type ReturnRefund = { kind: "cash"; accountId: string } | { kind: "reduce_claim" };

const roleIds = (accounts: readonly Account[], role: SystemRole) =>
  new Set(accounts.filter((a) => a.systemRole === role).map((a) => a.id));

/** Jenis retur untuk transaksi asal (penjualan/pembelian barang), atau null. */
export function returnKindOf(target: JournalEntry, accounts: readonly Account[]): ReturnKind | null {
  const inventory = roleIds(accounts, "inventory");
  const itemLines = target.lines.filter((l) => l.itemId && inventory.has(l.accountId) && (l.quantity ?? 0) > 0);
  if (itemLines.length === 0) return null;
  if (target.source === "revenue" && itemLines.every((l) => l.credit > 0)) return "sales";
  if (target.source === "purchase" && itemLines.every((l) => l.debit > 0)) return "purchase";
  return null;
}

/** Retur aktif (posted & belum di-void) atas transaksi asal. */
export function activeReturnsOf(entries: readonly JournalEntry[], targetId: string): JournalEntry[] {
  const reversed = new Set(entries.filter((e) => isLedgerEntry(e) && e.reversalOf).map((e) => e.reversalOf));
  return entries.filter((e) => isLedgerEntry(e) && e.returnOf === targetId && !reversed.has(e.id));
}

export interface ReturnableItem {
  itemId: string;
  /** Qty pada transaksi asal. */
  quantity: number;
  returnedQty: number;
  remainingQty: number;
  /** Nilai Persediaan asal (HPP penjualan / harga beli) & yang sudah diretur. */
  cost: number;
  returnedCost: number;
  /** Harga jual asal (retur penjualan) & yang sudah diretur. */
  revenue: number;
  returnedRevenue: number;
}

/** Barang yang masih dapat diretur dari transaksi asal. */
export function returnableItems(
  target: JournalEntry,
  activeReturns: readonly JournalEntry[],
  accounts: readonly Account[],
): ReturnableItem[] {
  const inventory = roleIds(accounts, "inventory");
  const revenueIds = new Set(accounts.filter((a) => a.accountType === "revenue").map((a) => a.id));
  const byItem = new Map<string, ReturnableItem>();
  const get = (itemId: string) => {
    let row = byItem.get(itemId);
    if (!row) {
      row = { itemId, quantity: 0, returnedQty: 0, remainingQty: 0, cost: 0, returnedCost: 0, revenue: 0, returnedRevenue: 0 };
      byItem.set(itemId, row);
    }
    return row;
  };
  for (const line of target.lines) {
    if (!line.itemId) continue;
    if (inventory.has(line.accountId) && (line.quantity ?? 0) > 0) {
      const row = get(line.itemId);
      row.quantity += line.quantity ?? 0;
      row.cost += line.debit + line.credit;
    } else if (revenueIds.has(line.accountId)) {
      get(line.itemId).revenue += line.credit;
    }
  }
  for (const entry of activeReturns) {
    for (const line of entry.lines) {
      const row = line.itemId ? byItem.get(line.itemId) : undefined;
      if (!row) continue;
      if (inventory.has(line.accountId)) {
        row.returnedQty += line.quantity ?? 0;
        row.returnedCost += line.debit + line.credit;
      } else if (revenueIds.has(line.accountId)) {
        row.returnedRevenue += line.debit;
      }
    }
  }
  for (const row of byItem.values()) row.remainingQty = row.quantity - row.returnedQty;
  return [...byItem.values()];
}

/** Bagian proporsional; bila mengambil semua sisa, memakai sisa nominal (tanpa selisih pembulatan). */
function portion(total: number, already: number, qty: number, totalQty: number, remainingQty: number): number {
  return qty === remainingQty ? total - already : mulDivRound(total, qty, totalQty);
}

function claimLine(target: JournalEntry, accounts: readonly Account[], role: SystemRole): JournalLineInput | undefined {
  const ids = roleIds(accounts, role);
  return target.lines.find((l) => ids.has(l.accountId));
}

export interface ReturnInput {
  workspaceId: string;
  entryDate: IsoDate;
  description?: string;
  target: JournalEntry;
  activeReturns: readonly JournalEntry[];
  lines: readonly { itemId: string; quantity: number }[];
  refund: ReturnRefund;
}

/** Jurnal retur penjualan atau pembelian sesuai jenis transaksi asal. */
export function buildReturn(input: ReturnInput, accounts: readonly Account[]): JournalEntryInput {
  const kind = returnKindOf(input.target, accounts);
  if (!kind || input.target.status !== "posted") fail("INVALID_RETURN", "Transaksi asal bukan penjualan/pembelian barang yang sudah diposting");
  const returnable = new Map(returnableItems(input.target, input.activeReturns, accounts).map((r) => [r.itemId, r]));
  const requested = input.lines.filter((l) => l.quantity > 0);
  if (requested.length === 0) fail("INVALID_QUANTITY", "Isi qty retur minimal satu barang");
  const inventory = accountByRole(accounts, "inventory").id;

  const itemLines: JournalLineInput[] = [];
  const contraLines: JournalLineInput[] = [];
  let costTotal = 0;
  let valueTotal = 0;
  let allRemaining = true;
  for (const line of requested) {
    const row = returnable.get(line.itemId);
    if (!row) fail("INVALID_RETURN", "Barang tidak ada pada transaksi asal");
    if (!Number.isSafeInteger(line.quantity) || line.quantity > row.remainingQty) {
      fail("INVALID_RETURN", `Qty retur melebihi sisa yang dapat diretur (${row.remainingQty})`);
    }
    if (line.quantity !== row.remainingQty) allRemaining = false;
    const cost = portion(row.cost, row.returnedCost, line.quantity, row.quantity, row.remainingQty);
    costTotal += cost;
    if (kind === "sales") {
      const revenue = portion(row.revenue, row.returnedRevenue, line.quantity, row.quantity, row.remainingQty);
      valueTotal += revenue;
      contraLines.push({ accountId: accountByRole(accounts, "sales_returns").id, description: "Retur penjualan", debit: revenue, credit: 0, itemId: line.itemId, quantity: line.quantity });
      itemLines.push({ accountId: inventory, description: "Barang kembali (retur)", debit: cost, credit: 0, itemId: line.itemId, quantity: line.quantity });
    } else {
      valueTotal += cost;
      itemLines.push({ accountId: inventory, description: "Retur pembelian", debit: 0, credit: cost, itemId: line.itemId, quantity: line.quantity });
    }
  }
  if (allRemaining) {
    // Semua sisa barang diretur hanya bila tidak ada barang lain yang masih tersisa.
    allRemaining = [...returnable.values()].every((r) => r.remainingQty === 0 || requested.some((l) => l.itemId === r.itemId));
  }

  // Pajak proporsional terhadap nilai barang (harga jual / harga beli) transaksi asal.
  const taxRole: SystemRole = kind === "sales" ? "sales_tax_payable" : "input_vat";
  const taxIds = roleIds(accounts, taxRole);
  const originalTax = input.target.lines.filter((l) => taxIds.has(l.accountId)).reduce((t, l) => t + l.debit + l.credit, 0);
  const returnedTax = input.activeReturns.flatMap((e) => e.lines).filter((l) => taxIds.has(l.accountId)).reduce((t, l) => t + l.debit + l.credit, 0);
  const baseTotal = [...returnable.values()].reduce((t, r) => t + (kind === "sales" ? r.revenue : r.cost), 0);
  const tax = originalTax === 0 ? 0 : allRemaining ? originalTax - returnedTax : mulDivRound(originalTax, valueTotal, baseTotal);
  const total = valueTotal + tax;

  let counterAccountId: string;
  if (input.refund.kind === "cash") {
    counterAccountId = input.refund.accountId;
  } else {
    const claim = claimLine(input.target, accounts, kind === "sales" ? "accounts_receivable" : "accounts_payable");
    if (!claim) fail("INVALID_RETURN", "Transaksi asal bukan transaksi kredit; pilih pengembalian tunai");
    counterAccountId = claim.accountId;
  }

  const lines: JournalLineInput[] =
    kind === "sales"
      ? [
          ...contraLines,
          ...(tax > 0 ? [{ accountId: accountByRole(accounts, "sales_tax_payable").id, description: "Pajak atas retur", debit: tax, credit: 0 }] : []),
          { accountId: counterAccountId, description: input.refund.kind === "cash" ? "Pengembalian dana" : "Pengurangan piutang", debit: 0, credit: total },
          ...itemLines,
          { accountId: accountByRole(accounts, "cogs").id, description: "HPP barang diretur", debit: 0, credit: costTotal },
        ]
      : [
          { accountId: counterAccountId, description: input.refund.kind === "cash" ? "Pengembalian dana" : "Pengurangan utang", debit: total, credit: 0 },
          ...itemLines,
          ...(tax > 0 ? [{ accountId: accountByRole(accounts, "input_vat").id, description: "PPN Masukan atas retur", debit: 0, credit: tax }] : []),
        ];

  const label = input.target.entryNumber ?? input.target.id;
  return {
    workspaceId: input.workspaceId,
    entryDate: input.entryDate,
    description: input.description?.trim() || `${kind === "sales" ? "Retur penjualan" : "Retur pembelian"} ${label}`,
    source: input.refund.kind === "cash" ? "return" : "settlement",
    counterparty: input.target.counterparty,
    settlementOf: input.refund.kind === "reduce_claim" ? input.target.id : null,
    returnOf: input.target.id,
    lines,
  };
}

/**
 * Pertahanan terakhir (repository/RPC): transaksi asal valid dan qty retur
 * kumulatif per barang tidak melebihi qty asal.
 */
export function validateReturn(
  entry: JournalEntryInput,
  context: { target: JournalEntry | null; targetReversed: boolean; activeReturns: readonly JournalEntry[]; accounts: readonly Account[] },
): ValidationIssue[] {
  const invalid = (message: string): ValidationIssue[] => [{ code: "INVALID_RETURN", message }];
  if (entry.source !== "return" && entry.source !== "settlement") return invalid("Jurnal retur harus bersumber 'return' atau 'settlement'");
  const { target } = context;
  if (!target || target.status !== "posted" || target.deletedAt !== null || target.workspaceId !== entry.workspaceId) {
    return invalid("Transaksi yang diretur tidak ditemukan");
  }
  if (context.targetReversed) return invalid("Transaksi yang diretur sudah di-void");
  if (!returnKindOf(target, context.accounts)) return invalid("Transaksi asal bukan penjualan/pembelian barang");
  const inventory = roleIds(context.accounts, "inventory");
  const returnable = new Map(returnableItems(target, context.activeReturns, context.accounts).map((r) => [r.itemId, r]));
  const requested = new Map<string, number>();
  for (const line of entry.lines) {
    if (line.itemId && inventory.has(line.accountId)) requested.set(line.itemId, (requested.get(line.itemId) ?? 0) + (line.quantity ?? 0));
  }
  for (const [itemId, qty] of requested) {
    const row = returnable.get(itemId);
    if (!row) return invalid("Barang tidak ada pada transaksi asal");
    if (qty > row.remainingQty) return invalid(`Qty retur melebihi sisa yang dapat diretur (${row.remainingQty})`);
  }
  return [];
}
