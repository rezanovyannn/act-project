/**
 * Transaksi khusus F&B dengan metode persediaan periodik (ADR 007).
 */
import { fail } from "@/core/errors"
import { generalLedger } from "@/core/general-ledger"
import { accountByRole, buildExpense, type Payment } from "@/core/transactions"
import type { Account, IsoDate, JournalEntry, JournalEntryInput } from "@/core/types"

export interface RawMaterialPurchaseInput {
  workspaceId: string
  entryDate: IsoDate
  description: string
  payment: Payment
  amount: number
}

/** Pembelian bahan baku: Dr Persediaan Bahan Baku, Cr Kas/Bank atau Utang Usaha. */
export function buildRawMaterialPurchase(
  input: RawMaterialPurchaseInput,
  accounts: readonly Account[],
): JournalEntryInput {
  return buildExpense(
    {
      workspaceId: input.workspaceId,
      entryDate: input.entryDate,
      description: input.description,
      payment: input.payment,
      source: "purchase",
      items: [
        { accountId: accountByRole(accounts, "raw_material_inventory").id, amount: input.amount },
      ],
    },
    accounts,
  )
}

/** Saldo buku Persediaan Bahan Baku per akhir `asOf` (jurnal posted). */
export function inventoryBookBalance(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  asOf: IsoDate,
): number {
  const inventory = accountByRole(accounts, "raw_material_inventory")
  return generalLedger(entries, inventory, { toDate: asOf }).closingBalance
}

export interface StockOpnameInput {
  workspaceId: string
  entryDate: IsoDate
  /** Saldo buku persediaan per tanggal opname. */
  bookBalance: number
  /** Nilai rupiah persediaan hasil hitung fisik. */
  physicalValue: number
  description?: string
}

export interface StockOpnameResult {
  /** Selisih buku − fisik: positif = pemakaian bahan (menambah HPP). */
  difference: number
  /** `null` bila tidak ada selisih (tidak perlu jurnal). */
  entry: JournalEntryInput | null
}

/**
 * Stok opname: selisih saldo buku dan nilai fisik diposting ke HPP.
 * Buku > fisik: Dr HPP, Cr Persediaan. Buku < fisik: Dr Persediaan, Cr HPP.
 */
export function buildStockOpname(
  input: StockOpnameInput,
  accounts: readonly Account[],
): StockOpnameResult {
  if (!Number.isSafeInteger(input.physicalValue) || input.physicalValue < 0) {
    fail("INVALID_AMOUNT", "Nilai persediaan fisik harus bilangan bulat Rupiah tidak negatif")
  }
  const difference = input.bookBalance - input.physicalValue
  if (difference === 0) return { difference, entry: null }

  const inventory = accountByRole(accounts, "raw_material_inventory").id
  const cogs = accountByRole(accounts, "cogs").id
  const amount = Math.abs(difference)
  const [debit, credit] = difference > 0 ? [cogs, inventory] : [inventory, cogs]
  return {
    difference,
    entry: {
      workspaceId: input.workspaceId,
      entryDate: input.entryDate,
      description: input.description?.trim() || "Penyesuaian stok opname ke HPP",
      source: "adjustment",
      lines: [
        { accountId: debit, debit: amount, credit: 0 },
        { accountId: credit, debit: 0, credit: amount },
      ],
    },
  }
}
