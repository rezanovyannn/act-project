/**
 * Menu, resep, porsi terjual, dan analisa variance Theoretical vs Actual
 * (ADR 021). Theoretical = porsi × resep yang berlaku pada tanggalnya × harga
 * satuan stok opname; dihitung pecahan eksak (BigInt) lalu dibulatkan sekali
 * ke rupiah. Actual = COGS per bahan dari stok opname (ADR 020).
 */
import { isValidIsoDate } from "./dates";
import { fail } from "./errors";
import { computeSalesTax, type SalesTaxSettings } from "./sales-tax";
import {
  compareBySection,
  computeCountRows,
  countableItems,
  previousCount,
  rowsOfSavedCount,
  type CountContext,
  type QtyValue,
} from "./stock-count";
import { buildSale, type Payment, type SalePreview } from "./transactions";
import type {
  Account,
  IsoDate,
  Item,
  JournalEntryInput,
  Menu,
  MenuInput,
  MenuSale,
  MenuSaleLine,
  PortionSummary,
  PortionSummaryInput,
  Recipe,
  RecipeInput,
  StockCount,
  StockValuation,
} from "./types";

// ---------- Pecahan eksak ----------

/** Pecahan non-negatif n/d (d > 0), dipakai untuk qty teoritis. */
export interface Fraction {
  n: bigint;
  d: bigint;
}

const ZERO_FRACTION: Fraction = { n: BigInt(0), d: BigInt(1) };

function gcd(a: bigint, b: bigint): bigint {
  while (b !== BigInt(0)) [a, b] = [b, a % b];
  return a < BigInt(0) ? -a : a;
}

function addFraction(a: Fraction, b: Fraction): Fraction {
  const n = a.n * b.d + b.n * a.d;
  const d = a.d * b.d;
  const g = gcd(n, d) || BigInt(1);
  return { n: n / g, d: d / g };
}

/** Pembagian bulat setengah menjauhi nol, seperti `mulDivRound`. */
function roundDiv(num: bigint, den: bigint): number {
  const negative = num < BigInt(0) !== den < BigInt(0);
  const a = num < BigInt(0) ? -num : num;
  const b = den < BigInt(0) ? -den : den;
  const q = (a * BigInt(2) + b) / (b * BigInt(2));
  const result = Number(negative ? -q : q);
  if (!Number.isSafeInteger(result)) fail("AMOUNT_OVERFLOW", "Nominal melewati batas yang didukung");
  return result;
}

/** Qty pecahan untuk tampilan (bukan untuk menghitung nilai). */
export const fractionToNumber = (f: Fraction) => Number(f.n) / Number(f.d);

/** Nilai rupiah qty pecahan pada dasar harga (nilai ÷ qty); 0 bila tanpa dasar harga. */
export function fractionValue(qty: Fraction, basis: QtyValue | null): number {
  if (qty.n === BigInt(0) || !basis) return 0;
  return roundDiv(BigInt(basis.value) * qty.n, qty.d * BigInt(basis.qty));
}

// ---------- Validasi master ----------

const isCount = (n: number) => Number.isSafeInteger(n) && n > 0;

export function validateMenuInput(input: MenuInput): MenuInput {
  const clean: MenuInput = {
    code: input.code.trim(),
    name: input.name.trim(),
    category: input.category?.trim() || null,
    price: input.price,
    revenueAccountId: input.revenueAccountId || null,
  };
  if (clean.code === "") fail("EMPTY_NAME", "Kode menu wajib diisi");
  if (clean.name === "") fail("EMPTY_NAME", "Nama menu wajib diisi");
  if (!Number.isSafeInteger(clean.price) || clean.price < 0) fail("INVALID_AMOUNT", "Harga jual harus bilangan bulat ≥ 0");
  return clean;
}

/** Validasi versi resep terhadap daftar bahan workspace. */
export function validateRecipe(input: RecipeInput, items: readonly Item[]): RecipeInput {
  if (!isValidIsoDate(input.effectiveFrom)) fail("INVALID_DATE", "Tanggal berlaku resep tidak valid");
  if (!isCount(input.yieldPortions) || input.yieldPortions > 1_000_000) {
    fail("INVALID_RECIPE", "Jumlah porsi resep harus bilangan bulat 1–1.000.000");
  }
  if (input.lines.length === 0) fail("INVALID_RECIPE", "Resep minimal berisi satu bahan");
  const seen = new Set<string>();
  for (const line of input.lines) {
    const item = items.find((i) => i.id === line.itemId && i.workspaceId === input.workspaceId && i.deletedAt === null);
    if (!item) fail("ITEM_NOT_FOUND", "Bahan pada resep tidak ditemukan");
    if (seen.has(item.id)) fail("INVALID_RECIPE", `${item.name} muncul dua kali di resep`);
    seen.add(item.id);
    if (!isCount(line.quantity)) fail("INVALID_QUANTITY", `${item.name}: qty harus bilangan bulat > 0 (${item.unit})`);
  }
  return { ...input, lines: input.lines.map((l) => ({ ...l })) };
}

/** Validasi rekap porsi: rentang tanggal, menu, porsi > 0 (baris 0 dibuang), tanpa tumpang tindih. */
export function validatePortionSummary(
  input: PortionSummaryInput,
  menus: readonly Menu[],
  existing: readonly PortionSummary[],
): PortionSummaryInput {
  if (!isValidIsoDate(input.dateFrom) || !isValidIsoDate(input.dateTo)) fail("INVALID_DATE", "Tanggal rekap tidak valid");
  if (input.dateFrom > input.dateTo) fail("INVALID_DATE", "Tanggal awal rekap harus sebelum atau sama dengan tanggal akhir");
  const overlap = existing.find((s) => s.workspaceId === input.workspaceId && s.dateFrom <= input.dateTo && input.dateFrom <= s.dateTo);
  if (overlap) fail("INVALID_PORTION_SUMMARY", `Rentang bertumpuk dengan rekap ${overlap.dateFrom} s.d. ${overlap.dateTo}`);
  const seen = new Set<string>();
  const lines = input.lines.filter((l) => l.portions !== 0);
  for (const line of input.lines) {
    if (!Number.isSafeInteger(line.portions) || line.portions < 0) fail("INVALID_QUANTITY", "Porsi harus bilangan bulat ≥ 0");
  }
  if (lines.length === 0) fail("INVALID_PORTION_SUMMARY", "Isi porsi minimal satu menu");
  for (const line of lines) {
    const menu = menus.find((m) => m.id === line.menuId && m.workspaceId === input.workspaceId && m.deletedAt === null);
    if (!menu) fail("MENU_NOT_FOUND", "Menu pada rekap tidak ditemukan");
    if (seen.has(menu.id)) fail("INVALID_PORTION_SUMMARY", `${menu.name} muncul dua kali di rekap`);
    seen.add(menu.id);
  }
  return { ...input, note: input.note?.trim() || null, lines: lines.map((l) => ({ ...l })) };
}

/** Versi resep menu yang berlaku pada `date` (tanggal berlaku terbaru ≤ date). */
export function recipeAt(recipes: readonly Recipe[], menuId: string, date: IsoDate): Recipe | null {
  let found: Recipe | null = null;
  for (const r of recipes) {
    if (r.menuId === menuId && r.effectiveFrom <= date && (!found || r.effectiveFrom > found.effectiveFrom)) found = r;
  }
  return found;
}

/** Dasar harga satuan per bahan pada `date` (sama dengan stok opname bertanggal itu). */
export function basesAt(ctx: CountContext, date: IsoDate, valuation: StockValuation): Map<string, QtyValue | null> {
  const zeros = new Map(countableItems(ctx, date).map((i) => [i.id, 0]));
  return new Map(computeCountRows(ctx, date, zeros, valuation).map((r) => [r.item.id, r.basis]));
}

/** Estimasi biaya bahan per porsi sebuah versi resep; `missing` = bahan tanpa harga. */
export function recipeCostPerPortion(recipe: Recipe, bases: ReadonlyMap<string, QtyValue | null>): { cost: number; missing: string[] } {
  let cost = 0;
  const missing: string[] = [];
  for (const line of recipe.lines) {
    const basis = bases.get(line.itemId) ?? null;
    if (!basis) missing.push(line.itemId);
    cost += fractionValue({ n: BigInt(line.quantity), d: BigInt(recipe.yieldPortions) }, basis);
  }
  return { cost, missing };
}

// ---------- Penjualan menu ----------

export interface MenuSaleInput {
  workspaceId: string;
  entryDate: IsoDate;
  description: string;
  payment: Payment;
  lines: readonly MenuSaleLine[];
  applyTax: boolean;
  tax: SalesTaxSettings;
  taxLabel?: string;
}

export interface MenuSalePlan {
  sale: SalePreview;
  entry: JournalEntryInput;
  lines: MenuSaleLine[];
}

/** Penjualan per menu: jurnal penjualan + PB1 (buildSale) dan rincian porsinya. */
export function buildMenuSale(input: MenuSaleInput, menus: readonly Menu[], accounts: readonly Account[]): MenuSalePlan {
  if (input.lines.length === 0) fail("LINE_ZERO", "Isi minimal satu menu");
  const rows = input.lines.map((line) => {
    const menu = menus.find((m) => m.id === line.menuId && m.deletedAt === null);
    if (!menu) fail("MENU_NOT_FOUND", "Menu tidak ditemukan");
    if (!menu.isActive) fail("MENU_INACTIVE", `${menu.name} nonaktif`);
    if (!menu.revenueAccountId) fail("INVALID_ACCOUNT", `${menu.name} belum punya akun pendapatan; atur di Menu & Resep`);
    if (!isCount(line.portions)) fail("INVALID_QUANTITY", `${menu.name}: porsi harus bilangan bulat > 0`);
    if (!isCount(line.amount)) fail("LINE_ZERO", `${menu.name}: nominal harus lebih dari 0`);
    return { menu, line };
  });
  const sale = buildSale(
    {
      workspaceId: input.workspaceId,
      entryDate: input.entryDate,
      description: input.description,
      payment: input.payment,
      applyTax: input.applyTax,
      tax: input.tax,
      taxLabel: input.taxLabel,
      items: rows.map(({ menu, line }) => ({
        accountId: menu.revenueAccountId!,
        amount: line.amount,
        description: `${menu.name} × ${line.portions}`,
      })),
    },
    accounts,
  );
  return { sale, entry: sale.entry, lines: rows.map(({ line }) => ({ ...line })) };
}

// ---------- Porsi per periode ----------

export interface PortionEntry {
  menuId: string;
  portions: number;
  /** Tanggal pemilihan versi resep: tanggal penjualan, atau tanggal akhir rekap. */
  date: IsoDate;
  source: "summary" | "sale";
}

/**
 * Porsi terjual dalam (fromExclusive, toInclusive]. Rekap dihitung bila tanggal
 * akhirnya di periode; penjualan menu pada tanggal yang tercakup rekap mana pun
 * diabaikan (rekap menggantikan, ADR 021).
 */
export function portionsForPeriod(
  summaries: readonly PortionSummary[],
  sales: readonly MenuSale[],
  fromExclusive: IsoDate | null,
  toInclusive: IsoDate,
): { entries: PortionEntry[]; warnings: string[] } {
  const inPeriod = (d: IsoDate) => (fromExclusive === null || d > fromExclusive) && d <= toInclusive;
  const covered = (d: IsoDate) => summaries.some((s) => s.dateFrom <= d && d <= s.dateTo);
  const entries: PortionEntry[] = [];
  const warnings: string[] = [];
  for (const s of summaries.filter((x) => inPeriod(x.dateTo))) {
    if (fromExclusive !== null && s.dateFrom <= fromExclusive) {
      warnings.push(`Rekap ${s.dateFrom} s.d. ${s.dateTo} dimulai sebelum stok opname sebelumnya; seluruh porsinya dihitung di periode ini`);
    }
    for (const l of s.lines) entries.push({ menuId: l.menuId, portions: l.portions, date: s.dateTo, source: "summary" });
  }
  for (const sale of sales.filter((x) => inPeriod(x.entryDate) && !covered(x.entryDate))) {
    for (const l of sale.lines) entries.push({ menuId: l.menuId, portions: l.portions, date: sale.entryDate, source: "sale" });
  }
  return { entries, warnings };
}

// ---------- Variance ----------

export interface MenuContext extends CountContext {
  menus: readonly Menu[];
  recipes: readonly Recipe[];
  summaries: readonly PortionSummary[];
  sales: readonly MenuSale[];
}

export interface VarianceRow {
  item: Item;
  /** Dasar harga satuan stok opname (nilai ÷ qty). */
  basis: QtyValue | null;
  theoretical: { qty: Fraction; value: number };
  actual: QtyValue;
  /** Actual − Theoretical; positif = pemakaian melebihi resep. */
  variance: { qty: number; value: number };
  /** Variance ÷ theoretical (nilai); null bila theoretical 0. */
  ratio: number | null;
}

export interface MenuUsageRow {
  menu: Menu | null;
  menuId: string;
  portions: number;
  summaryPortions: number;
  salePortions: number;
  /** Porsi tanpa resep berlaku (tidak masuk theoretical). */
  noRecipePortions: number;
  /** Theoretical cost menu ini (dibulatkan per bahan). */
  cost: number;
}

export interface VarianceAnalysis {
  count: StockCount;
  previous: StockCount | null;
  rows: VarianceRow[];
  menus: MenuUsageRow[];
  totals: { theoretical: number; actual: number; variance: number };
  warnings: string[];
}

/** Variance per bahan untuk periode stok opname `count` (setelah stok opname aktif sebelumnya). */
export function analyzeVariance(ctx: MenuContext, count: StockCount): VarianceAnalysis {
  const previous = previousCount(ctx.counts.filter((c) => c.id !== count.id), count.countDate);
  const countRows = rowsOfSavedCount(ctx, count);
  const { entries, warnings } = portionsForPeriod(ctx.summaries, ctx.sales, previous?.countDate ?? null, count.countDate);

  const byItem = new Map<string, Fraction>();
  const byMenu = new Map<string, { row: MenuUsageRow; perItem: Map<string, Fraction> }>();
  for (const entry of entries) {
    let menu = byMenu.get(entry.menuId);
    if (!menu) {
      menu = {
        row: {
          menu: ctx.menus.find((m) => m.id === entry.menuId) ?? null,
          menuId: entry.menuId,
          portions: 0,
          summaryPortions: 0,
          salePortions: 0,
          noRecipePortions: 0,
          cost: 0,
        },
        perItem: new Map(),
      };
      byMenu.set(entry.menuId, menu);
    }
    menu.row.portions += entry.portions;
    if (entry.source === "summary") menu.row.summaryPortions += entry.portions;
    else menu.row.salePortions += entry.portions;
    const recipe = recipeAt(ctx.recipes, entry.menuId, entry.date);
    if (!recipe) {
      menu.row.noRecipePortions += entry.portions;
      continue;
    }
    for (const line of recipe.lines) {
      const used = { n: BigInt(entry.portions) * BigInt(line.quantity), d: BigInt(recipe.yieldPortions) };
      byItem.set(line.itemId, addFraction(byItem.get(line.itemId) ?? ZERO_FRACTION, used));
      menu.perItem.set(line.itemId, addFraction(menu.perItem.get(line.itemId) ?? ZERO_FRACTION, used));
    }
  }

  const rows: VarianceRow[] = countRows.map((r) => {
    const qty = byItem.get(r.item.id) ?? ZERO_FRACTION;
    return varianceRow(r.item, r.basis, qty, r.cogs);
  });
  for (const [itemId, qty] of byItem) {
    if (rows.some((r) => r.item.id === itemId)) continue;
    const item = ctx.items.find((i) => i.id === itemId);
    if (!item) continue;
    warnings.push(`${item.name} dipakai resep tetapi tidak ada di stok opname ini; theoretical-nya tanpa harga`);
    rows.push(varianceRow(item, null, qty, { qty: 0, value: 0 }));
  }
  rows.sort((a, b) => compareBySection(a.item, b.item));

  const basisOf = new Map(rows.map((r) => [r.item.id, r.basis]));
  const menus = [...byMenu.values()].map(({ row, perItem }) => {
    let cost = 0;
    for (const [itemId, qty] of perItem) cost += fractionValue(qty, basisOf.get(itemId) ?? null);
    if (row.noRecipePortions > 0) {
      warnings.push(`${row.menu?.name ?? "Menu terhapus"}: ${row.noRecipePortions} porsi tanpa resep berlaku (tidak masuk theoretical)`);
    }
    return { ...row, cost };
  });
  menus.sort((a, b) => (a.menu?.code ?? "").localeCompare(b.menu?.code ?? "", "id"));

  const theoretical = rows.reduce((t, r) => t + r.theoretical.value, 0);
  const actual = rows.reduce((t, r) => t + r.actual.value, 0);
  return { count, previous, rows, menus, totals: { theoretical, actual, variance: actual - theoretical }, warnings };
}

function varianceRow(item: Item, basis: QtyValue | null, qty: Fraction, actual: QtyValue): VarianceRow {
  const value = fractionValue(qty, basis);
  const variance = actual.value - value;
  return {
    item,
    basis,
    theoretical: { qty, value },
    actual: { qty: actual.qty, value: actual.value },
    variance: { qty: actual.qty - fractionToNumber(qty), value: variance },
    ratio: value === 0 ? null : variance / value,
  };
}

// ---------- Laporan per menu (Fase 8C) ----------

export interface MenuReportRow {
  menu: Menu | null;
  menuId: string;
  portions: number;
  salePortions: number;
  summaryPortions: number;
  /** Pendapatan tanpa pajak: penjualan menu (aktual) + rekap porsi (estimasi). */
  revenue: number;
  /** Bagian pendapatan yang diestimasi dari rekap porsi × harga jual menu. */
  estimatedRevenue: number;
  /** Biaya bahan teoritis: resep berlaku pada tanggal jual × harga bahan per akhir periode. */
  cost: number;
  margin: number;
  /** Porsi tanpa resep berlaku (biayanya tidak terhitung). */
  noRecipePortions: number;
}

export interface MenuReport {
  rows: MenuReportRow[];
  totals: { portions: number; revenue: number; estimatedRevenue: number; cost: number; margin: number };
  warnings: string[];
}

/**
 * Penjualan, biaya bahan, dan margin per menu dalam [from, to] (ROADMAP 8C).
 * Porsi: penjualan menu bertanggal di periode yang tidak dicakup rekap + rekap
 * yang tanggal akhirnya di periode (aturan sama dengan variance, ADR 021).
 */
export function menuReport(
  ctx: MenuContext,
  from: IsoDate,
  to: IsoDate,
  options: { valuation: StockValuation; tax: SalesTaxSettings | null },
): MenuReport {
  const inRange = (d: IsoDate) => d >= from && d <= to;
  const covered = (d: IsoDate) => ctx.summaries.some((s) => s.dateFrom <= d && d <= s.dateTo);
  const bases = basesAt(ctx, to, options.valuation);
  const journals = new Map(ctx.entries.map((e) => [e.id, e]));
  const rows = new Map<string, MenuReportRow & { perItem: Map<string, Fraction> }>();
  const row = (menuId: string) => {
    let r = rows.get(menuId);
    if (!r) {
      r = {
        menu: ctx.menus.find((m) => m.id === menuId) ?? null,
        menuId,
        portions: 0,
        salePortions: 0,
        summaryPortions: 0,
        revenue: 0,
        estimatedRevenue: 0,
        cost: 0,
        margin: 0,
        noRecipePortions: 0,
        perItem: new Map(),
      };
      rows.set(menuId, r);
    }
    return r;
  };
  const addUsage = (r: MenuReportRow & { perItem: Map<string, Fraction> }, portions: number, date: IsoDate) => {
    const recipe = recipeAt(ctx.recipes, r.menuId, date);
    if (!recipe) {
      r.noRecipePortions += portions;
      return;
    }
    for (const line of recipe.lines) {
      const used = { n: BigInt(portions) * BigInt(line.quantity), d: BigInt(recipe.yieldPortions) };
      r.perItem.set(line.itemId, addFraction(r.perItem.get(line.itemId) ?? ZERO_FRACTION, used));
    }
  };

  for (const sale of ctx.sales) {
    if (!inRange(sale.entryDate) || covered(sale.entryDate)) continue;
    const entry = journals.get(sale.journalEntryId);
    sale.lines.forEach((line, i) => {
      const r = row(line.menuId);
      r.portions += line.portions;
      r.salePortions += line.portions;
      // Baris pendapatan jurnal penjualan menu (setelah baris kas/piutang) = nominal tanpa pajak.
      const credit = entry?.lines[i + 1]?.credit;
      r.revenue += credit && credit > 0 ? credit : line.amount;
      addUsage(r, line.portions, sale.entryDate);
    });
  }
  for (const summary of ctx.summaries) {
    if (!inRange(summary.dateTo)) continue;
    for (const line of summary.lines) {
      const r = row(line.menuId);
      r.portions += line.portions;
      r.summaryPortions += line.portions;
      const gross = line.portions * (r.menu?.price ?? 0);
      const estimate = options.tax && options.tax.inclusive && options.tax.rateBps > 0 ? computeSalesTax(gross, options.tax).base : gross;
      r.revenue += estimate;
      r.estimatedRevenue += estimate;
      addUsage(r, line.portions, summary.dateTo);
    }
  }

  const warnings: string[] = [];
  const result = [...rows.values()].map(({ perItem, ...r }) => {
    let cost = 0;
    let missing = 0;
    for (const [itemId, qty] of perItem) {
      const basis = bases.get(itemId) ?? null;
      if (!basis) missing += 1;
      cost += fractionValue(qty, basis);
    }
    if (r.noRecipePortions > 0) warnings.push(`${r.menu?.name ?? "Menu terhapus"}: ${r.noRecipePortions} porsi tanpa resep berlaku (biaya bahan tidak terhitung)`);
    if (missing > 0) warnings.push(`${r.menu?.name ?? "Menu terhapus"}: ${missing} bahan belum ada harga per ${to}`);
    return { ...r, cost, margin: r.revenue - cost };
  });
  result.sort((a, b) => b.portions - a.portions || (a.menu?.name ?? "").localeCompare(b.menu?.name ?? "", "id"));
  const totals = result.reduce(
    (t, r) => ({
      portions: t.portions + r.portions,
      revenue: t.revenue + r.revenue,
      estimatedRevenue: t.estimatedRevenue + r.estimatedRevenue,
      cost: t.cost + r.cost,
      margin: t.margin + r.margin,
    }),
    { portions: 0, revenue: 0, estimatedRevenue: 0, cost: 0, margin: 0 },
  );
  return { rows: result, totals, warnings };
}
