import { stockMovements } from "@/core/stock"
import type { Account, IsoDate, Item, JournalEntry } from "@/core/types"

/**
 * Peringatan transaksi barang bertanggal mundur (ADR 017): HPP jurnal yang
 * sudah diposting sesudah tanggal ini tidak dihitung ulang.
 */
export function backdateWarnings(
  journals: readonly JournalEntry[],
  accounts: readonly Account[],
  items: readonly Item[],
  itemIds: readonly string[],
  date: IsoDate,
): string[] {
  const later = new Set(
    stockMovements(journals, accounts)
      .filter((m) => itemIds.includes(m.itemId) && m.entryDate > date)
      .map((m) => m.itemId),
  )
  return items
    .filter((i) => later.has(i.id))
    .map((i) => `${i.code} ${i.name}: sudah ada transaksi sesudah tanggal ini; HPP transaksi tersebut tidak dihitung ulang (selisih terserap di stok opname)`)
}
