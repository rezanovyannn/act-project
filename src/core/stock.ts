/**
 * Mesin persediaan perpetual (ADR 017). Stok & harga pokok per barang
 * diturunkan dari baris jurnal posted pada akun ber-`system_role = inventory`
 * yang membawa barang: debit = masuk, kredit = keluar, nominal = nilai.
 * Semua aritmetika integer (BigInt), pembulatan setengah ke atas (ADR 005).
 */
import { fail } from "./errors";
import { generalLedger } from "./general-ledger";
import { isLedgerEntry } from "./ledger";
import type { Account, CostMethod, CostMethodPeriod, IsoDate, JournalEntry, JournalSource } from "./types";

const ZERO = BigInt(0);
const TWO = BigInt(2);

/** round(a × b ÷ c) setengah menjauhi nol, untuk bilangan bertanda. */
export function mulDivRound(a: number, b: number, c: number): number {
  if (c === 0) fail("AMOUNT_OVERFLOW", "Pembagian dengan nol pada perhitungan harga pokok");
  const num = BigInt(a) * BigInt(b);
  const den = BigInt(c);
  const negative = num < ZERO !== den < ZERO;
  const absNum = num < ZERO ? -num : num;
  const absDen = den < ZERO ? -den : den;
  const q = (absNum * TWO + absDen) / (absDen * TWO);
  const result = Number(negative ? -q : q);
  if (!Number.isSafeInteger(result)) fail("AMOUNT_OVERFLOW", "Nominal melewati batas yang didukung");
  return result;
}

export interface StockMovement {
  itemId: string;
  entryId: string;
  entryNumber: string | null;
  entryDate: IsoDate;
  source: JournalSource;
  description: string;
  lineNo: number;
  /** + masuk, − keluar (satuan dasar). */
  quantity: number;
  /** + debit Persediaan, − kredit Persediaan. */
  value: number;
}

const inventoryAccountIds = (accounts: readonly Account[]) =>
  new Set(accounts.filter((a) => a.systemRole === "inventory").map((a) => a.id));

/** Mutasi stok dari jurnal posted, terurut tanggal lalu waktu posting. */
export function stockMovements(entries: readonly JournalEntry[], accounts: readonly Account[]): StockMovement[] {
  const inventory = inventoryAccountIds(accounts);
  const ordered = entries
    .filter(isLedgerEntry)
    .sort(
      (a, b) =>
        a.entryDate.localeCompare(b.entryDate) ||
        (a.postedAt ?? a.createdAt).localeCompare(b.postedAt ?? b.createdAt) ||
        a.id.localeCompare(b.id),
    );
  const movements: StockMovement[] = [];
  for (const entry of ordered) {
    for (const line of entry.lines) {
      if (!line.itemId || !inventory.has(line.accountId)) continue;
      const qty = line.quantity ?? 0;
      const inbound = line.debit > 0;
      movements.push({
        itemId: line.itemId,
        entryId: entry.id,
        entryNumber: entry.entryNumber,
        entryDate: entry.entryDate,
        source: entry.source,
        description: line.description ?? entry.description,
        lineNo: line.lineNo,
        quantity: inbound ? qty : -qty,
        value: line.debit - line.credit,
      });
    }
  }
  return movements;
}

/** Metode biaya yang berlaku pada tanggal (default rata-rata). */
export function costMethodAt(history: readonly CostMethodPeriod[], date: IsoDate): CostMethod {
  let method: CostMethod = "average";
  for (const period of history) if (period.from <= date) method = period.method;
  return method;
}

export interface CostLayer {
  qty: number;
  value: number;
}

export interface ItemStock {
  itemId: string;
  qty: number;
  value: number;
  method: CostMethod;
  /** Lapisan FIFO (hanya bila qty > 0 pada metode FIFO). */
  layers: CostLayer[];
  /** Harga pokok terakhir yang diketahui, untuk barang keluar saat stok kurang/minus. */
  lastUnit: CostLayer | null;
}

function emptyStock(itemId: string, method: CostMethod): ItemStock {
  return { itemId, qty: 0, value: 0, method, layers: [], lastUnit: null };
}

function consumeLayers(layers: CostLayer[], qty: number): { cost: number; rest: CostLayer[] } {
  let remaining = qty;
  let cost = 0;
  const rest: CostLayer[] = [];
  for (const layer of layers) {
    if (remaining === 0) {
      rest.push({ ...layer });
      continue;
    }
    const take = Math.min(remaining, layer.qty);
    const part = take === layer.qty ? layer.value : mulDivRound(layer.value, take, layer.qty);
    cost += part;
    remaining -= take;
    if (take < layer.qty) rest.push({ qty: layer.qty - take, value: layer.value - part });
  }
  return { cost, rest };
}

/** Menjaga lapisan FIFO konsisten dengan qty & nilai tercatat (nilai jurnal adalah kebenaran). */
function syncLayers(stock: ItemStock): void {
  if (stock.method !== "fifo" || stock.qty <= 0) {
    stock.layers = stock.method === "fifo" && stock.qty > 0 ? [{ qty: stock.qty, value: stock.value }] : [];
    return;
  }
  const layerQty = stock.layers.reduce((t, l) => t + l.qty, 0);
  if (layerQty !== stock.qty || stock.layers.length === 0) {
    stock.layers = [{ qty: stock.qty, value: stock.value }];
    return;
  }
  const layerValue = stock.layers.reduce((t, l) => t + l.value, 0);
  stock.layers[0] = { ...stock.layers[0], value: stock.layers[0].value + (stock.value - layerValue) };
}

function refreshLastUnit(stock: ItemStock): void {
  if (stock.qty > 0 && stock.value > 0) {
    stock.lastUnit =
      stock.method === "fifo" && stock.layers.length > 0 ? { ...stock.layers[stock.layers.length - 1] } : { qty: stock.qty, value: stock.value };
  }
}

function applyMovement(stock: ItemStock, movement: StockMovement, method: CostMethod): void {
  if (stock.method !== method) {
    // Peralihan metode: stok saat itu menjadi satu lapisan/harga awal (ADR 017).
    stock.method = method;
    stock.layers = method === "fifo" && stock.qty > 0 ? [{ qty: stock.qty, value: stock.value }] : [];
  }
  if (movement.quantity > 0) {
    if (stock.method === "fifo" && stock.qty >= 0) stock.layers.push({ qty: movement.quantity, value: movement.value });
    if (movement.value > 0) stock.lastUnit = { qty: movement.quantity, value: movement.value };
    stock.qty += movement.quantity;
    stock.value += movement.value;
  } else if (movement.quantity < 0) {
    if (stock.method === "fifo") stock.layers = consumeLayers(stock.layers, Math.min(-movement.quantity, Math.max(stock.qty, 0))).rest;
    stock.qty += movement.quantity;
    stock.value += movement.value;
  } else {
    stock.value += movement.value;
  }
  syncLayers(stock);
  refreshLastUnit(stock);
}

/** Stok per barang dari mutasi terurut, sampai `asOf` (inklusif) bila diisi. */
export function computeStock(
  movements: readonly StockMovement[],
  history: readonly CostMethodPeriod[],
  asOf?: IsoDate,
): Map<string, ItemStock> {
  const stocks = new Map<string, ItemStock>();
  for (const movement of movements) {
    if (asOf && movement.entryDate > asOf) break;
    const method = costMethodAt(history, movement.entryDate);
    const stock = stocks.get(movement.itemId) ?? emptyStock(movement.itemId, method);
    applyMovement(stock, movement, method);
    stocks.set(movement.itemId, stock);
  }
  return stocks;
}

/** Stok per barang langsung dari jurnal. */
export function stockAt(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  history: readonly CostMethodPeriod[],
  asOf?: IsoDate,
): Map<string, ItemStock> {
  return computeStock(stockMovements(entries, accounts), history, asOf);
}

/** Stok barang pada metode yang berlaku di `date` (stok kosong bila belum ada mutasi). */
export function stockForDate(
  stocks: ReadonlyMap<string, ItemStock>,
  itemId: string,
  history: readonly CostMethodPeriod[],
  date: IsoDate,
): ItemStock {
  const method = costMethodAt(history, date);
  const current = stocks.get(itemId);
  if (!current) return emptyStock(itemId, method);
  const copy: ItemStock = { ...current, layers: current.layers.map((l) => ({ ...l })) };
  if (copy.method !== method) {
    copy.method = method;
    copy.layers = method === "fifo" && copy.qty > 0 ? [{ qty: copy.qty, value: copy.value }] : [];
  }
  return copy;
}

export interface OutflowPlan {
  /** Harga pokok barang keluar (nominal baris kredit Persediaan). */
  cost: number;
  /** Qty yang melebihi stok (stok menjadi/semakin minus). */
  shortage: number;
}

/**
 * Harga pokok `qty` barang keluar. Qty melebihi stok dinilai dengan harga
 * pokok terakhir; tanpa harga pokok sama sekali ditolak (UNKNOWN_COST).
 */
export function planOutflow(stock: ItemStock, qty: number, itemLabel = "Barang"): OutflowPlan {
  if (!Number.isSafeInteger(qty) || qty <= 0) fail("INVALID_QUANTITY", `${itemLabel}: kuantitas keluar harus lebih dari 0`);
  const available = Math.max(stock.qty, 0);
  const fromStock = Math.min(qty, available);
  const shortage = qty - fromStock;
  let cost = 0;
  if (fromStock > 0) {
    cost =
      stock.method === "fifo"
        ? consumeLayers(stock.layers, fromStock).cost
        : fromStock === stock.qty
          ? stock.value
          : mulDivRound(stock.value, fromStock, stock.qty);
  }
  if (shortage > 0) {
    if (!stock.lastUnit) {
      fail("UNKNOWN_COST", `${itemLabel}: harga pokok belum diketahui; catat pembelian atau stok awal lebih dulu`);
    }
    cost += mulDivRound(stock.lastUnit.value, shortage, stock.lastUnit.qty);
  }
  if (cost <= 0) fail("UNKNOWN_COST", `${itemLabel}: harga pokok Rp 0 tidak dapat dicatat; periksa nilai persediaan barang ini`);
  return { cost, shortage };
}

/**
 * Koreksi HPP saat barang masuk menutup stok minus (ADR 017): selisih harga
 * beli sebenarnya dengan harga pokok sementara unit yang sudah keluar.
 * Positif = Dr HPP, Cr Persediaan; negatif = sebaliknya; 0 = tidak perlu.
 */
export function negativeStockCorrection(stock: ItemStock, qty: number, value: number): number {
  if (stock.qty >= 0 || qty <= 0) return 0;
  const negative = -stock.qty;
  const covered = Math.min(negative, qty);
  const actual = covered === qty ? value : mulDivRound(value, covered, qty);
  const provisional = covered === negative ? -stock.value : mulDivRound(-stock.value, covered, negative);
  return actual - provisional;
}

/** Harga pokok per satuan untuk menilai barang masuk tanpa harga (mis. selisih lebih stok opname). */
export function unitCostOf(stock: ItemStock): CostLayer | null {
  if (stock.qty > 0 && stock.value > 0) return { qty: stock.qty, value: stock.value };
  return stock.lastUnit;
}

export interface StockCardRow extends StockMovement {
  balanceQty: number;
  balanceValue: number;
}

/** Kartu stok satu barang: mutasi beserta saldo berjalan. */
export function stockCard(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  history: readonly CostMethodPeriod[],
  itemId: string,
): StockCardRow[] {
  const rows: StockCardRow[] = [];
  let stock: ItemStock | null = null;
  for (const movement of stockMovements(entries, accounts)) {
    if (movement.itemId !== itemId) continue;
    const method = costMethodAt(history, movement.entryDate);
    stock ??= emptyStock(itemId, method);
    applyMovement(stock, movement, method);
    rows.push({ ...movement, balanceQty: stock.qty, balanceValue: stock.value });
  }
  return rows;
}

export interface InventoryReconciliation {
  /** Saldo akun Persediaan di Buku Besar. */
  accountBalance: number;
  /** Jumlah nilai per barang. */
  itemizedValue: number;
  /** Saldo Persediaan yang belum dirinci per barang (mis. dari metode periodik). */
  unitemized: number;
}

/** Rekonsiliasi saldo per barang dengan akun Persediaan (kriteria ROADMAP 4C). */
export function inventoryReconciliation(
  entries: readonly JournalEntry[],
  accounts: readonly Account[],
  stocks: ReadonlyMap<string, ItemStock>,
  asOf?: IsoDate,
): InventoryReconciliation {
  const posted = entries.filter(isLedgerEntry);
  const accountBalance = accounts
    .filter((a) => a.systemRole === "inventory")
    .reduce((t, a) => t + generalLedger(posted, a, asOf ? { toDate: asOf } : {}).closingBalance, 0);
  const itemizedValue = [...stocks.values()].reduce((t, s) => t + s.value, 0);
  return { accountBalance, itemizedValue, unitemized: accountBalance - itemizedValue };
}
