/**
 * Stok opname sisa bahan & tabel COGS (ADR 020). Nilai stok akhir per bahan =
 * qty sisa × harga satuan (rata-rata periode atau beli terakhir), dihitung
 * integer dengan pembulatan setengah ke atas tanpa menyimpan harga pecahan.
 */
import { fail } from "./errors";
import { generalLedger } from "./general-ledger";
import { buildStockOpname } from "./inventory";
import { isLedgerEntry } from "./ledger";
import { reversedEntryIds } from "./reversal";
import { mulDivRound } from "./stock";
import type { Account, IsoDate, Item, JournalEntry, JournalEntryInput, StockCount, StockCountInput, StockValuation } from "./types";

export interface QtyValue {
  qty: number;
  value: number;
}

interface PurchaseSummary extends QtyValue {
  /** Pembelian terakhir (qty & nilai baris) untuk harga beli terakhir. */
  last: QtyValue | null;
}

const ZERO: QtyValue = { qty: 0, value: 0 };

const inventoryIds = (accounts: readonly Account[]) =>
  new Set(accounts.filter((a) => a.systemRole === "inventory").map((a) => a.id));

/** Urutan tanggal lalu waktu posting (stabil). */
function byPosting(a: JournalEntry, b: JournalEntry): number {
  return a.entryDate.localeCompare(b.entryDate) || (a.postedAt ?? a.createdAt).localeCompare(b.postedAt ?? b.createdAt);
}

/**
 * Mutasi bersih baris Persediaan ber-barang dalam (fromExclusive, toInclusive].
 * Void & retur ikut terhitung (bersih). Harga terakhir diambil dari pembelian
 * yang masih berlaku s.d. `toInclusive` (tanpa batas bawah).
 */
export function purchasesByItem(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  fromExclusive: IsoDate | null,
  toInclusive: IsoDate,
): Map<string, PurchaseSummary> {
  const inventory = inventoryIds(accounts);
  const reversed = reversedEntryIds(entries);
  const result = new Map<string, PurchaseSummary>();
  const get = (itemId: string) => {
    let row = result.get(itemId);
    if (!row) result.set(itemId, (row = { qty: 0, value: 0, last: null }));
    return row;
  };
  for (const entry of entries.filter(isLedgerEntry).sort(byPosting)) {
    if (entry.entryDate > toInclusive) continue;
    const inRange = fromExclusive === null || entry.entryDate > fromExclusive;
    const validPurchase = !reversed.has(entry.id) && entry.source !== "reversal";
    for (const line of entry.lines) {
      if (!line.itemId || !inventory.has(line.accountId)) continue;
      const qty = line.quantity ?? 0;
      if (inRange) {
        const row = get(line.itemId);
        row.qty += line.debit > 0 ? qty : -qty;
        row.value += line.debit - line.credit;
      }
      if (validPurchase && line.debit > 0 && qty > 0) get(line.itemId).last = { qty, value: line.debit };
    }
  }
  return result;
}

/** Stok opname aktif terakhir sebelum `date` (atau null). */
export function previousCount(counts: readonly StockCount[], date: IsoDate): StockCount | null {
  return [...counts].filter((c) => c.countDate < date).sort((a, b) => b.countDate.localeCompare(a.countDate))[0] ?? null;
}

export interface CountRow {
  item: Item;
  begin: QtyValue;
  purchase: QtyValue;
  end: QtyValue;
  /** Stok Awal + Pembelian − Stok Akhir. */
  cogs: QtyValue;
  /** Dasar harga satuan (nilai ÷ qty) menurut metode; null bila tidak diketahui. */
  basis: QtyValue | null;
  /** Harga satuan tidak diketahui (nilai sisa = 0). */
  noCost: boolean;
}

/** Section untuk pengelompokan; kosong = "Tanpa section". */
export const sectionOf = (item: Pick<Item, "category">) => item.category?.trim() || "Tanpa section";

/** Urutan section (abjad, "Tanpa section" terakhir) lalu kode barang. */
export function compareBySection(a: Pick<Item, "category" | "code">, b: Pick<Item, "category" | "code">): number {
  const sa = a.category?.trim() || "";
  const sb = b.category?.trim() || "";
  if (sa !== sb) return sa === "" ? 1 : sb === "" ? -1 : sa.localeCompare(sb, "id");
  return a.code.localeCompare(b.code, "id");
}

/**
 * Dasar harga satuan menurut metode, sebagai pasangan nilai/qty (harga satuan =
 * value ÷ qty, tidak disimpan sebagai pecahan); null bila tidak ada dasar harga.
 */
export function unitBasis(
  valuation: StockValuation,
  begin: QtyValue,
  purchase: PurchaseSummary | undefined,
  previousUnit: QtyValue | null,
): QtyValue | null {
  if (valuation === "last" && purchase?.last) return purchase.last;
  const pool = { qty: begin.qty + (purchase?.qty ?? 0), value: begin.value + (purchase?.value ?? 0) };
  if (valuation === "average" && pool.qty > 0 && pool.value > 0) return pool;
  return purchase?.last ?? (previousUnit && previousUnit.qty > 0 ? previousUnit : null);
}

/** Nilai sisa `qty` dari dasar harga (pembulatan setengah menjauhi nol); null bila tanpa dasar harga. */
export function valueAtBasis(qty: number, basis: QtyValue | null): number | null {
  if (qty === 0) return 0;
  return basis ? mulDivRound(basis.value, qty, basis.qty) : null;
}

/** Nilai sisa `qty` menurut metode; null bila tidak ada dasar harga. */
export function valueOfRemaining(
  qty: number,
  valuation: StockValuation,
  begin: QtyValue,
  purchase: PurchaseSummary | undefined,
  previousUnit: QtyValue | null,
): number | null {
  return valueAtBasis(qty, unitBasis(valuation, begin, purchase, previousUnit));
}

export interface CountContext {
  items: readonly Item[];
  accounts: readonly Account[];
  entries: readonly JournalEntry[];
  /** Stok opname aktif workspace (semua tanggal). */
  counts: readonly StockCount[];
}

/** Bahan yang tampil pada stok opname per tanggal: aktif, atau punya stok/pembelian. */
export function countableItems(context: CountContext, date: IsoDate): Item[] {
  const prev = previousCount(context.counts, date);
  const purchases = purchasesByItem(context.entries, context.accounts, prev?.countDate ?? null, date);
  return context.items
    .filter((i) => i.deletedAt === null)
    .filter((i) => i.isActive || purchases.has(i.id) || prev?.lines.some((l) => l.itemId === i.id && l.quantity !== 0))
    .sort(compareBySection);
}

/**
 * Baris COGS untuk qty sisa per bahan pada `date`. `quantities` wajib berisi
 * semua bahan yang tampil (0 boleh); nilai sisa memakai `valuation`.
 */
export function computeCountRows(
  context: CountContext,
  date: IsoDate,
  quantities: ReadonlyMap<string, number>,
  valuation: StockValuation,
): CountRow[] {
  const prev = previousCount(context.counts, date);
  const purchases = purchasesByItem(context.entries, context.accounts, prev?.countDate ?? null, date);
  const priorUnits = new Map<string, QtyValue>();
  for (const count of [...context.counts].filter((c) => c.countDate < date).sort((a, b) => a.countDate.localeCompare(b.countDate))) {
    for (const line of count.lines) if (line.quantity > 0 && line.value > 0) priorUnits.set(line.itemId, { qty: line.quantity, value: line.value });
  }
  return countableItems(context, date).map((item) => {
    const prevLine = prev?.lines.find((l) => l.itemId === item.id);
    const begin = prevLine ? { qty: prevLine.quantity, value: prevLine.value } : ZERO;
    const purchase = purchases.get(item.id);
    const qty = quantities.get(item.id);
    if (qty === undefined || !Number.isSafeInteger(qty) || qty < 0) {
      fail("INVALID_QUANTITY", `${item.code} ${item.name}: isi qty sisa (bilangan bulat ≥ 0, ${item.unit})`);
    }
    const basis = unitBasis(valuation, begin, purchase, priorUnits.get(item.id) ?? null);
    const value = valueAtBasis(qty, basis);
    const end = { qty, value: value ?? 0 };
    const buy = { qty: purchase?.qty ?? 0, value: purchase?.value ?? 0 };
    return {
      item,
      begin,
      purchase: buy,
      end,
      cogs: { qty: begin.qty + buy.qty - end.qty, value: begin.value + buy.value - end.value },
      basis,
      noCost: value === null,
    };
  });
}

/** Total qty & nilai baris. */
export function sumRows(rows: readonly CountRow[]): Record<"begin" | "purchase" | "end" | "cogs", number> {
  return rows.reduce(
    (t, r) => ({ begin: t.begin + r.begin.value, purchase: t.purchase + r.purchase.value, end: t.end + r.end.value, cogs: t.cogs + r.cogs.value }),
    { begin: 0, purchase: 0, end: 0, cogs: 0 },
  );
}

export interface StockCountPlan {
  count: StockCountInput;
  rows: CountRow[];
  /** Saldo buku akun Persediaan per tanggal opname. */
  bookBalance: number;
  /** Jurnal penyesuaian HPP; null bila tidak ada selisih. */
  journal: JournalEntryInput | null;
  /** Selisih total COGS tabel dengan penyesuaian jurnal (pembelian tanpa rincian bahan). */
  unitemizedDifference: number;
}

/** Stok opname siap disimpan: baris COGS, nilai sisa, dan jurnal penyesuaian (ADR 020). */
export function buildStockCount(
  context: CountContext,
  input: { workspaceId: string; countDate: IsoDate; valuation: StockValuation; quantities: ReadonlyMap<string, number> },
): StockCountPlan {
  const latest = [...context.counts].sort((a, b) => b.countDate.localeCompare(a.countDate))[0];
  if (latest && input.countDate <= latest.countDate) {
    fail("INVALID_STOCK_COUNT", `Tanggal stok opname harus setelah stok opname terakhir (${latest.countDate})`);
  }
  const rows = computeCountRows(context, input.countDate, input.quantities, input.valuation);
  const inventory = context.accounts.filter((a) => a.systemRole === "inventory");
  if (inventory.length === 0) fail("ACCOUNT_NOT_FOUND", "Akun persediaan belum ada");
  const posted = context.entries.filter(isLedgerEntry);
  const bookBalance = inventory.reduce((t, a) => t + generalLedger(posted, a, { toDate: input.countDate }).closingBalance, 0);
  const totals = sumRows(rows);
  const opname = buildStockOpname(
    {
      workspaceId: input.workspaceId,
      entryDate: input.countDate,
      bookBalance,
      physicalValue: totals.end,
      description: `Stok opname sisa bahan ${input.countDate}`,
    },
    context.accounts,
  );
  return {
    count: {
      workspaceId: input.workspaceId,
      countDate: input.countDate,
      valuation: input.valuation,
      lines: rows.map((r) => ({ itemId: r.item.id, quantity: r.end.qty, value: r.end.value })),
    },
    rows,
    bookBalance,
    journal: opname.entry,
    // Penyesuaian jurnal (buku − fisik) dikurangi COGS tabel (awal + beli − fisik).
    unitemizedDifference: bookBalance - totals.begin - totals.purchase,
  };
}

/** Baris COGS dari stok opname yang sudah disimpan (untuk tab COGS). */
export function rowsOfSavedCount(context: CountContext, count: StockCount): CountRow[] {
  const others = context.counts.filter((c) => c.id !== count.id && c.countDate < count.countDate);
  const scoped = { ...context, counts: others };
  const saved = new Map(count.lines.map((l) => [l.itemId, l]));
  // Bahan yang belum ada saat opname disimpan dihitung qty 0 lalu disembunyikan bila tanpa mutasi.
  const quantities = new Map(countableItems(scoped, count.countDate).map((i) => [i.id, saved.get(i.id)?.quantity ?? 0]));
  return computeCountRows(scoped, count.countDate, quantities, count.valuation)
    .filter((r) => saved.has(r.item.id) || r.begin.qty !== 0 || r.purchase.qty !== 0)
    .map((r) => {
      const line = saved.get(r.item.id);
      const end = line ? { qty: line.quantity, value: line.value } : r.end;
      return { ...r, end, cogs: { qty: r.begin.qty + r.purchase.qty - end.qty, value: r.begin.value + r.purchase.value - end.value } };
    });
}
