/**
 * Persediaan metode periodik untuk semua template (ADR 007 & 015): pembelian
 * masuk ke akun ber-`systemRole` `inventory`, selisih stok opname ke HPP.
 */
import { fail } from "./errors"
import { generalLedger } from "./general-ledger"
import { accountByRole, buildExpense, type Payment } from "./transactions"
import type { Account, IsoDate, JournalEntry, JournalEntryInput } from "./types"

export interface InventoryPurchaseInput {
  workspaceId: string
  entryDate: IsoDate
  description: string
  payment: Payment
  amount: number
  /** PPN Masukan sesuai faktur (mode PPN lengkap, ADR 016). */
  inputVat?: number
}

/** Pembelian persediaan: Dr Persediaan (+ Dr PPN Masukan), Cr Kas/Bank atau Utang Usaha. */
export function buildInventoryPurchase(
  input: InventoryPurchaseInput,
  accounts: readonly Account[],
): JournalEntryInput {
  return buildExpense(
    {
      workspaceId: input.workspaceId,
      entryDate: input.entryDate,
      description: input.description,
      payment: input.payment,
      source: "purchase",
      inputVat: input.inputVat,
      items: [
        { accountId: accountByRole(accounts, "inventory").id, amount: input.amount },
      ],
    },
    accounts,
  )
}

/** Saldo buku akun persediaan per akhir `asOf` (jurnal posted). */
export function inventoryBookBalance(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  asOf: IsoDate,
): number {
  const inventory = accountByRole(accounts, "inventory")
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

  const inventory = accountByRole(accounts, "inventory").id
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
