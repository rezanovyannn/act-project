/**
 * Transaksi persediaan perpetual per barang (ADR 017). Fungsi murni: hasilnya
 * diposting lewat JournalService. Harga pokok dihitung dari stok per tanggal
 * transaksi (`stocks` = hasil `stockAt(..., tanggal)`).
 */
import { fail } from "./errors";
import type { SalesTaxSettings } from "./sales-tax";
import {
  mulDivRound,
  negativeStockCorrection,
  planOutflow,
  stockForDate,
  unitCostOf,
  type ItemStock,
} from "./stock";
import { accountByRole, buildExpense, buildSale, type Payment, type SalePreview } from "./transactions";
import type { Account, CostMethodPeriod, IsoDate, Item, JournalEntryInput, JournalLineInput } from "./types";

export interface PerpetualContext {
  accounts: readonly Account[];
  items: readonly Item[];
  /** Stok per barang per tanggal transaksi. */
  stocks: ReadonlyMap<string, ItemStock>;
  costMethodHistory: readonly CostMethodPeriod[];
}

export interface ItemQuantity {
  itemId: string;
  quantity: number;
}

export interface ItemAmount extends ItemQuantity {
  /** Harga total baris (beli sebelum PPN, atau jual). */
  amount: number;
}

export interface PerpetualResult {
  entry: JournalEntryInput;
  /** Peringatan non-fatal, mis. stok menjadi minus. */
  warnings: string[];
}

function requireItem(context: PerpetualContext, itemId: string): Item {
  const item = context.items.find((i) => i.id === itemId && i.deletedAt === null);
  if (!item) fail("ITEM_NOT_FOUND", "Barang tidak ditemukan");
  return item;
}

const label = (item: Item) => `${item.code} ${item.name}`;

function requireQuantities<T extends ItemQuantity>(lines: readonly T[], requireAmount = false): T[] {
  if (lines.length === 0) fail("LINE_ZERO", "Pilih minimal satu barang");
  const seen = new Set<string>();
  for (const line of lines) {
    if (!line.itemId) fail("ITEM_NOT_FOUND", "Setiap baris wajib memilih barang");
    if (seen.has(line.itemId)) fail("INVALID_QUANTITY", "Barang yang sama muncul dua kali; gabungkan kuantitasnya");
    seen.add(line.itemId);
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      fail("INVALID_QUANTITY", "Kuantitas harus bilangan bulat lebih dari 0");
    }
    const amount = (line as unknown as { amount?: number }).amount;
    if (requireAmount && (!Number.isSafeInteger(amount) || (amount ?? 0) <= 0)) {
      fail("LINE_ZERO", "Nominal setiap barang harus lebih dari 0");
    }
  }
  return [...lines];
}

function stockOf(context: PerpetualContext, itemId: string, date: IsoDate): ItemStock {
  return stockForDate(context.stocks, itemId, context.costMethodHistory, date);
}

function shortageWarning(item: Item, stock: ItemStock, quantity: number): string {
  return `${label(item)}: stok tercatat ${stock.qty} ${item.unit}, keluar ${quantity} ${item.unit}; stok menjadi minus dan HPP memakai harga pokok terakhir`;
}

/**
 * Pembelian barang: Dr Persediaan per barang (qty, harga), koreksi HPP bila
 * menutup stok minus, [Dr PPN Masukan], Cr Kas/Bank atau Utang Usaha.
 */
export function buildItemPurchase(
  input: {
    workspaceId: string;
    entryDate: IsoDate;
    description: string;
    payment: Payment;
    lines: readonly ItemAmount[];
    inputVat?: number;
  },
  context: PerpetualContext,
): PerpetualResult {
  const lines = requireQuantities(input.lines, true);
  const inventory = accountByRole(context.accounts, "inventory");
  const base = buildExpense(
    {
      workspaceId: input.workspaceId,
      entryDate: input.entryDate,
      description: input.description,
      payment: input.payment,
      source: "purchase",
      inputVat: input.inputVat,
      items: lines.map((l) => ({ accountId: inventory.id, amount: l.amount, description: requireItem(context, l.itemId).name })),
    },
    context.accounts,
  );
  const withItems = base.lines.map((line, index) =>
    index < lines.length ? { ...line, itemId: lines[index].itemId, quantity: lines[index].quantity } : line,
  );
  const { lines: corrections, warnings } = purchaseCorrections(lines, input.entryDate, context);
  return { entry: { ...base, lines: [...withItems, ...corrections] }, warnings };
}

/**
 * Koreksi HPP saat pembelian menutup stok minus (ADR 017): dipakai form
 * pembelian per barang dan faktur pembelian (ADR 022).
 */
export function purchaseCorrections(
  lines: readonly ItemAmount[],
  entryDate: IsoDate,
  context: PerpetualContext,
): { lines: JournalLineInput[]; warnings: string[] } {
  const inventory = accountByRole(context.accounts, "inventory");
  const corrections: JournalLineInput[] = [];
  const warnings: string[] = [];
  for (const line of lines) {
    const item = requireItem(context, line.itemId);
    const correction = negativeStockCorrection(stockOf(context, line.itemId, entryDate), line.quantity, line.amount);
    if (correction === 0) continue;
    const cogs = accountByRole(context.accounts, "cogs").id;
    const text = `Koreksi HPP stok minus ${item.name}`;
    corrections.push(
      correction > 0
        ? { accountId: cogs, description: text, debit: correction, credit: 0 }
        : { accountId: inventory.id, description: text, debit: -correction, credit: 0, itemId: item.id, quantity: 0 },
      correction > 0
        ? { accountId: inventory.id, description: text, debit: 0, credit: correction, itemId: item.id, quantity: 0 }
        : { accountId: cogs, description: text, debit: 0, credit: -correction },
    );
    warnings.push(`${label(item)}: menutup stok minus, HPP dikoreksi ${correction > 0 ? "naik" : "turun"} ${Math.abs(correction)}`);
  }
  return { lines: corrections, warnings };
}

/** Baris keluar Persediaan per barang + total harga pokok. */
export function outflowLines(
  lines: readonly ItemQuantity[],
  date: IsoDate,
  context: PerpetualContext,
): { credit: JournalLineInput[]; totalCost: number; warnings: string[] } {
  const inventory = accountByRole(context.accounts, "inventory");
  const warnings: string[] = [];
  let totalCost = 0;
  const credit = lines.map((line) => {
    const item = requireItem(context, line.itemId);
    const stock = stockOf(context, line.itemId, date);
    const plan = planOutflow(stock, line.quantity, label(item));
    if (plan.shortage > 0) warnings.push(shortageWarning(item, stock, line.quantity));
    totalCost += plan.cost;
    return {
      accountId: inventory.id,
      description: item.name,
      debit: 0,
      credit: plan.cost,
      itemId: item.id,
      quantity: line.quantity,
    };
  });
  return { credit, totalCost, warnings };
}

export interface ItemSaleResult extends PerpetualResult {
  sale: SalePreview;
  totalCost: number;
}

/**
 * Penjualan barang: Dr Kas/Piutang, Cr pendapatan default barang (qty),
 * [Cr utang pajak]; Dr HPP, Cr Persediaan per barang (harga pokok).
 */
export function buildItemSale(
  input: {
    workspaceId: string;
    entryDate: IsoDate;
    description: string;
    payment: Payment;
    lines: readonly ItemAmount[];
    applyTax: boolean;
    tax: SalesTaxSettings;
    taxLabel?: string;
  },
  context: PerpetualContext,
): ItemSaleResult {
  const lines = requireQuantities(input.lines, true);
  const items = lines.map((l) => requireItem(context, l.itemId));
  for (const item of items) {
    if (!item.revenueAccountId) fail("INVALID_ACCOUNT", `${label(item)} belum punya akun pendapatan; atur di Daftar Barang`);
  }
  const sale = buildSale(
    {
      workspaceId: input.workspaceId,
      entryDate: input.entryDate,
      description: input.description,
      payment: input.payment,
      applyTax: input.applyTax,
      tax: input.tax,
      taxLabel: input.taxLabel,
      items: lines.map((l, i) => ({ accountId: items[i].revenueAccountId!, amount: l.amount, description: items[i].name })),
    },
    context.accounts,
  );
  // Baris pendapatan (setelah baris debit) membawa barang & qty sebagai rujukan retur.
  const saleLines = sale.entry.lines.map((line, index) =>
    index >= 1 && index <= lines.length ? { ...line, itemId: lines[index - 1].itemId, quantity: lines[index - 1].quantity } : line,
  );
  const out = outflowLines(lines, input.entryDate, context);
  const cogs: JournalLineInput = {
    accountId: accountByRole(context.accounts, "cogs").id,
    description: "HPP barang terjual",
    debit: out.totalCost,
    credit: 0,
  };
  return {
    sale,
    totalCost: out.totalCost,
    warnings: out.warnings,
    entry: { ...sale.entry, lines: [...saleLines, cogs, ...out.credit] },
  };
}

/** Pemakaian barang (bahan terpakai, rusak, sampel): Dr HPP/beban, Cr Persediaan per barang. */
export function buildItemUsage(
  input: {
    workspaceId: string;
    entryDate: IsoDate;
    description: string;
    lines: readonly ItemQuantity[];
    /** Default akun HPP. */
    debitAccountId?: string;
  },
  context: PerpetualContext,
): PerpetualResult & { totalCost: number } {
  const lines = requireQuantities(input.lines);
  const out = outflowLines(lines, input.entryDate, context);
  const debitAccountId = input.debitAccountId || accountByRole(context.accounts, "cogs").id;
  return {
    totalCost: out.totalCost,
    warnings: out.warnings,
    entry: {
      workspaceId: input.workspaceId,
      entryDate: input.entryDate,
      description: input.description.trim() || "Pemakaian barang",
      source: "adjustment",
      lines: [{ accountId: debitAccountId, description: "Pemakaian barang", debit: out.totalCost, credit: 0 }, ...out.credit],
    },
  };
}

export interface StockCount {
  itemId: string;
  physicalQty: number;
  /** Harga pokok per satuan untuk selisih lebih bila barang belum punya harga pokok. */
  unitCost?: number | null;
}

export interface StockCountRow {
  itemId: string;
  bookQty: number;
  physicalQty: number;
  difference: number;
  /** + menambah persediaan (kurangi HPP), − mengurangi (tambah HPP). */
  value: number;
}

/**
 * Stok opname per barang: selisih qty fisik dinilai dengan harga pokok
 * berjalan; nilai bersihnya dibukukan ke HPP. `entry = null` bila tidak ada selisih.
 */
export function buildItemStockOpname(
  input: { workspaceId: string; entryDate: IsoDate; description?: string; counts: readonly StockCount[] },
  context: PerpetualContext,
): { entry: JournalEntryInput | null; rows: StockCountRow[] } {
  const inventory = accountByRole(context.accounts, "inventory");
  const lines: JournalLineInput[] = [];
  const rows: StockCountRow[] = [];
  for (const count of input.counts) {
    const item = requireItem(context, count.itemId);
    if (!Number.isSafeInteger(count.physicalQty) || count.physicalQty < 0) {
      fail("INVALID_QUANTITY", `${label(item)}: qty fisik harus bilangan bulat tidak negatif`);
    }
    const stock = stockOf(context, item.id, input.entryDate);
    const difference = count.physicalQty - stock.qty;
    let value = 0;
    if (difference < 0) {
      value = -planOutflow(stock, -difference, label(item)).cost;
      lines.push({ accountId: inventory.id, description: `Selisih kurang ${item.name}`, debit: 0, credit: -value, itemId: item.id, quantity: -difference });
    } else if (difference > 0) {
      const unit = count.unitCost && count.unitCost > 0 ? { qty: 1, value: count.unitCost } : unitCostOf(stock);
      if (!unit) fail("UNKNOWN_COST", `${label(item)}: isi harga pokok per ${item.unit} untuk selisih lebih`);
      value = mulDivRound(unit.value, difference, unit.qty);
      if (value <= 0) fail("UNKNOWN_COST", `${label(item)}: nilai selisih lebih harus lebih dari 0`);
      lines.push({ accountId: inventory.id, description: `Selisih lebih ${item.name}`, debit: value, credit: 0, itemId: item.id, quantity: difference });
    } else if (count.physicalQty === 0 && stock.value !== 0) {
      // Qty sudah nol tetapi masih ada sisa nilai (pembulatan/transaksi mundur): dinolkan.
      value = -stock.value;
      lines.push(
        value < 0
          ? { accountId: inventory.id, description: `Sisa nilai ${item.name}`, debit: 0, credit: -value, itemId: item.id, quantity: 0 }
          : { accountId: inventory.id, description: `Sisa nilai ${item.name}`, debit: value, credit: 0, itemId: item.id, quantity: 0 },
      );
    }
    rows.push({ itemId: item.id, bookQty: stock.qty, physicalQty: count.physicalQty, difference, value });
  }
  if (lines.length === 0) return { entry: null, rows };
  const net = lines.reduce((t, l) => t + l.debit - l.credit, 0);
  const cogs = accountByRole(context.accounts, "cogs").id;
  if (net !== 0) {
    lines.push(
      net > 0
        ? { accountId: cogs, description: "Selisih stok opname", debit: 0, credit: net }
        : { accountId: cogs, description: "Selisih stok opname", debit: -net, credit: 0 },
    );
  }
  if (lines.length < 2) return { entry: null, rows };
  return {
    entry: {
      workspaceId: input.workspaceId,
      entryDate: input.entryDate,
      description: input.description?.trim() || `Stok opname per barang ${input.entryDate}`,
      source: "adjustment",
      lines,
    },
    rows,
  };
}

export interface OpeningCount {
  itemId: string;
  quantity: number;
  value: number;
}

/**
 * Peralihan periodik → perpetual (ADR 017): menolkan saldo Persediaan tanpa
 * barang dan saldo barang yang dihitung, membukukan nilai baru per barang,
 * dan menjurnal selisihnya ke HPP. `null` bila tidak ada yang perlu dijurnal.
 */
export function buildPerpetualTransition(
  input: { workspaceId: string; entryDate: IsoDate; counts: readonly OpeningCount[]; accountBalance: number },
  context: PerpetualContext,
): JournalEntryInput | null {
  const inventory = accountByRole(context.accounts, "inventory");
  const cogs = accountByRole(context.accounts, "cogs").id;
  const lines: JournalLineInput[] = [];
  const seen = new Set<string>();
  const itemizedValue = [...context.stocks.values()].reduce((t, s) => t + s.value, 0);
  for (const count of input.counts) {
    const item = requireItem(context, count.itemId);
    if (seen.has(item.id)) fail("INVALID_QUANTITY", `${label(item)} muncul dua kali`);
    seen.add(item.id);
    if (!Number.isSafeInteger(count.quantity) || count.quantity < 0 || !Number.isSafeInteger(count.value) || count.value < 0) {
      fail("INVALID_QUANTITY", `${label(item)}: qty dan nilai harus bilangan bulat tidak negatif`);
    }
    if ((count.quantity > 0) !== (count.value > 0)) {
      fail("INVALID_QUANTITY", `${label(item)}: qty dan nilai harus sama-sama diisi (atau sama-sama 0)`);
    }
    const stock = stockOf(context, item.id, input.entryDate);
    if (stock.qty < 0 || (stock.qty > 0 && stock.value <= 0)) {
      fail("INVALID_QUANTITY", `${label(item)}: saldo stok lama tidak konsisten; lakukan stok opname per barang dulu`);
    }
    if (stock.qty > 0) {
      lines.push({ accountId: inventory.id, description: `Saldo lama ${item.name}`, debit: 0, credit: stock.value, itemId: item.id, quantity: stock.qty });
    } else if (stock.value !== 0) {
      lines.push(
        stock.value > 0
          ? { accountId: inventory.id, description: `Sisa nilai ${item.name}`, debit: 0, credit: stock.value, itemId: item.id, quantity: 0 }
          : { accountId: inventory.id, description: `Sisa nilai ${item.name}`, debit: -stock.value, credit: 0, itemId: item.id, quantity: 0 },
      );
    }
    if (count.quantity > 0) {
      lines.push({ accountId: inventory.id, description: `Stok awal ${item.name}`, debit: count.value, credit: 0, itemId: item.id, quantity: count.quantity });
    }
  }
  const unitemized = input.accountBalance - itemizedValue;
  if (unitemized > 0) lines.push({ accountId: inventory.id, description: "Saldo persediaan periodik", debit: 0, credit: unitemized });
  if (unitemized < 0) lines.push({ accountId: inventory.id, description: "Saldo persediaan periodik", debit: -unitemized, credit: 0 });
  const net = lines.reduce((t, l) => t + l.debit - l.credit, 0);
  if (net > 0) lines.push({ accountId: cogs, description: "Selisih stok awal perpetual", debit: 0, credit: net });
  if (net < 0) lines.push({ accountId: cogs, description: "Selisih stok awal perpetual", debit: -net, credit: 0 });
  if (lines.length < 2) return null;
  return {
    workspaceId: input.workspaceId,
    entryDate: input.entryDate,
    description: "Stok awal per barang (peralihan ke persediaan perpetual)",
    source: "adjustment",
    lines,
  };
}
