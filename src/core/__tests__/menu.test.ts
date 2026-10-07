/**
 * Menu, resep, porsi, dan variance Theoretical vs Actual (ADR 021). Angka harapan dihitung manual:
 *
 * Pembelian 10 Jan: Ayam 10.000 g Rp 500.000 (Rp 50/g), Beras 20.000 g Rp 300.000 (Rp 15/g),
 *   Telur 100 butir Rp 200.000 (Rp 2.000/butir).
 * Resep Nasi Goreng (1 porsi): v1 berlaku 1 Jan = Ayam 100 g, Beras 150 g, Telur 1;
 *   v2 berlaku 20 Jan = Ayam 120 g, Beras 150 g, Telur 1.
 * Resep Telur Dadar: 2 butir untuk 3 porsi (2/3 butir per porsi).
 * Porsi: penjualan 15 Jan NG 20 & TD 4 (resep v1); 25 Jan NG 30 & TD 5 (v2);
 *   rekap 26–28 Jan NG 10 & TD 3 (v2, tanggal akhir rekap); penjualan 27 Jan NG 99 diabaikan (tercakup rekap).
 * Theoretical: Ayam 20×100 + 40×120 = 6.800 g = 340.000; Beras 60×150 = 9.000 g = 135.000;
 *   Telur 60 + 12×2/3 = 68 butir = 136.000; total 611.000.
 * Stok opname 31 Jan (rata-rata): sisa Ayam 4.000 g (200.000), Beras 10.000 g (150.000), Telur 40 (80.000).
 * Actual (COGS): Ayam 300.000, Beras 150.000, Telur 120.000; total 570.000.
 * Variance = actual − theoretical: Ayam −40.000 (−800 g), Beras +15.000 (+1.000 g), Telur −16.000 (−8); total −41.000.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { AccountingError, type ValidationCode } from "@/core/errors";
import { fractionValue, menuReport, portionsForPeriod, recipeAt } from "@/core/menu";
import type { MenuSaleInput } from "@/core/menu";
import { parseCsv, parsePortionSheet, portionSheetRows } from "@/core/stock-count-sheet";
import { toCsv } from "@/core/backup";
import type { Account, Item, Menu } from "@/core/types";
import { createFnbWorkspace, createTestEnv } from "./helpers";

async function expectCode(promise: Promise<unknown>, code: ValidationCode) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(AccountingError);
  expect((error as AccountingError).issues.map((i) => i.code)).toContain(code);
}

describe("menu, resep & variance theoretical vs actual", () => {
  let env: ReturnType<typeof createTestEnv>;
  let workspaceId: string;
  let accounts: Account[];
  let ayam: Item;
  let beras: Item;
  let telur: Item;
  let nasiGoreng: Menu;
  let telurDadar: Menu;
  const byCode = (code: string) => accounts.find((a) => a.code === code)!;

  function sale(entryDate: string, lines: { menu: Menu; portions: number }[], overrides: Partial<MenuSaleInput> = {}): MenuSaleInput {
    return {
      workspaceId,
      entryDate,
      description: "Penjualan menu",
      payment: { kind: "cash", accountId: byCode("1-1100").id },
      lines: lines.map(({ menu, portions }) => ({ menuId: menu.id, portions, amount: portions * menu.price })),
      applyTax: false,
      tax: { rateBps: 1000, inclusive: false },
      taxLabel: "PB1",
      ...overrides,
    };
  }
  async function buy(item: Item, qty: number, value: number) {
    await env.journalService.postJournal({
      workspaceId,
      entryDate: "2026-01-10",
      description: `Beli ${item.name}`,
      source: "purchase",
      lines: [
        { accountId: byCode("1-1300").id, debit: value, credit: 0, itemId: item.id, quantity: qty },
        { accountId: byCode("1-1100").id, debit: 0, credit: value },
      ],
    });
  }

  beforeEach(async () => {
    env = createTestEnv();
    const ws = await createFnbWorkspace(env);
    workspaceId = ws.workspace.id;
    accounts = ws.accounts;
    await env.journalService.postJournal({
      workspaceId,
      entryDate: "2026-01-02",
      description: "Modal",
      source: "manual",
      lines: [
        { accountId: byCode("1-1100").id, debit: 5_000_000, credit: 0 },
        { accountId: byCode("3-1000").id, debit: 0, credit: 5_000_000 },
      ],
    });
    ayam = await env.itemService.createItem(workspaceId, { code: "P-01", name: "Ayam", unit: "gram", revenueAccountId: null, category: "Protein" });
    telur = await env.itemService.createItem(workspaceId, { code: "P-02", name: "Telur", unit: "butir", revenueAccountId: null, category: "Protein" });
    beras = await env.itemService.createItem(workspaceId, { code: "D-01", name: "Beras", unit: "gram", revenueAccountId: null, category: "Dry Goods" });
    await buy(ayam, 10_000, 500_000);
    await buy(beras, 20_000, 300_000);
    await buy(telur, 100, 200_000);
    nasiGoreng = await env.menuService.createMenu(workspaceId, { code: "M-01", name: "Nasi Goreng", category: "Makanan", price: 25_000, revenueAccountId: byCode("4-1000").id });
    telurDadar = await env.menuService.createMenu(workspaceId, { code: "M-02", name: "Telur Dadar", category: "Makanan", price: 10_000, revenueAccountId: byCode("4-1000").id });
    await env.menuService.saveRecipe({ workspaceId, menuId: nasiGoreng.id, effectiveFrom: "2026-01-01", yieldPortions: 1, lines: [{ itemId: ayam.id, quantity: 100 }, { itemId: beras.id, quantity: 150 }, { itemId: telur.id, quantity: 1 }] });
    await env.menuService.saveRecipe({ workspaceId, menuId: nasiGoreng.id, effectiveFrom: "2026-01-20", yieldPortions: 1, lines: [{ itemId: ayam.id, quantity: 120 }, { itemId: beras.id, quantity: 150 }, { itemId: telur.id, quantity: 1 }] });
    await env.menuService.saveRecipe({ workspaceId, menuId: telurDadar.id, effectiveFrom: "2026-01-01", yieldPortions: 3, lines: [{ itemId: telur.id, quantity: 2 }] });
  });

  it("penjualan menu: jurnal penjualan + PB1, porsi tersimpan; void mengeluarkan porsinya", async () => {
    const entry = await env.menuService.postSale(sale("2026-01-15", [{ menu: nasiGoreng, portions: 2 }, { menu: telurDadar, portions: 1 }], { applyTax: true }));
    expect(entry.source).toBe("revenue");
    expect(entry.lines.map((l) => [l.accountId, l.debit, l.credit, l.description])).toEqual([
      [byCode("1-1100").id, 66_000, 0, null],
      [byCode("4-1000").id, 0, 50_000, "Nasi Goreng × 2"],
      [byCode("4-1000").id, 0, 10_000, "Telur Dadar × 1"],
      [accounts.find((a) => a.systemRole === "sales_tax_payable")!.id, 0, 6_000, "PB1"],
    ]);
    expect(await env.repos.menus.listMenuSales(workspaceId)).toEqual([
      { journalEntryId: entry.id, workspaceId, entryDate: "2026-01-15", lines: [{ menuId: nasiGoreng.id, portions: 2, amount: 50_000 }, { menuId: telurDadar.id, portions: 1, amount: 10_000 }] },
    ]);
    await env.journalService.voidJournal(entry.id, "2026-01-16");
    expect(await env.repos.menus.listMenuSales(workspaceId)).toEqual([]);
  });

  it("resep: versi per tanggal berlaku, simpan ulang tanggal sama mengganti, validasi", async () => {
    const recipes = await env.repos.menus.listRecipes(workspaceId);
    expect(recipeAt(recipes, nasiGoreng.id, "2026-01-19")?.lines[0].quantity).toBe(100);
    expect(recipeAt(recipes, nasiGoreng.id, "2026-01-20")?.lines[0].quantity).toBe(120);
    expect(recipeAt(recipes, nasiGoreng.id, "2025-12-31")).toBeNull();
    await env.menuService.saveRecipe({ workspaceId, menuId: nasiGoreng.id, effectiveFrom: "2026-01-20", yieldPortions: 2, lines: [{ itemId: ayam.id, quantity: 250 }] });
    const after = (await env.repos.menus.listRecipes(workspaceId)).filter((r) => r.menuId === nasiGoreng.id);
    expect(after.map((r) => [r.effectiveFrom, r.yieldPortions])).toEqual([["2026-01-01", 1], ["2026-01-20", 2]]);

    const base = { workspaceId, menuId: nasiGoreng.id, effectiveFrom: "2026-02-01" };
    await expectCode(env.menuService.saveRecipe({ ...base, yieldPortions: 0, lines: [{ itemId: ayam.id, quantity: 1 }] }), "INVALID_RECIPE");
    await expectCode(env.menuService.saveRecipe({ ...base, yieldPortions: 1, lines: [] }), "INVALID_RECIPE");
    await expectCode(env.menuService.saveRecipe({ ...base, yieldPortions: 1, lines: [{ itemId: ayam.id, quantity: 1 }, { itemId: ayam.id, quantity: 2 }] }), "INVALID_RECIPE");
    await expectCode(env.menuService.saveRecipe({ ...base, yieldPortions: 1, lines: [{ itemId: ayam.id, quantity: 1.5 }] }), "INVALID_QUANTITY");
    // Bahan yang dipakai resep tidak bisa dihapus.
    await expectCode(env.itemService.deleteItem(beras.id), "ITEM_IN_USE");
  });

  it("rekap porsi menggantikan penjualan menu pada tanggal yang dicakup; rentang bertumpuk ditolak", async () => {
    await env.menuService.postSale(sale("2026-01-27", [{ menu: nasiGoreng, portions: 99 }]));
    await env.menuService.postSale(sale("2026-01-29", [{ menu: nasiGoreng, portions: 5 }]));
    await env.menuService.createPortionSummary({ workspaceId, dateFrom: "2026-01-26", dateTo: "2026-01-28", note: " POS ", lines: [{ menuId: nasiGoreng.id, portions: 10 }, { menuId: telurDadar.id, portions: 0 }] });
    const summaries = await env.repos.menus.listPortionSummaries(workspaceId);
    expect(summaries[0]).toMatchObject({ note: "POS", lines: [{ menuId: nasiGoreng.id, portions: 10 }] });
    const { entries } = portionsForPeriod(summaries, await env.repos.menus.listMenuSales(workspaceId), null, "2026-01-31");
    expect(entries.map((e) => [e.source, e.date, e.portions])).toEqual([["summary", "2026-01-28", 10], ["sale", "2026-01-29", 5]]);

    await expectCode(env.menuService.createPortionSummary({ workspaceId, dateFrom: "2026-01-28", dateTo: "2026-01-30", note: null, lines: [{ menuId: nasiGoreng.id, portions: 1 }] }), "INVALID_PORTION_SUMMARY");
    await expectCode(env.menuService.createPortionSummary({ workspaceId, dateFrom: "2026-02-01", dateTo: "2026-02-02", note: null, lines: [{ menuId: nasiGoreng.id, portions: 0 }] }), "INVALID_PORTION_SUMMARY");
    // Menu yang sudah punya rekap/penjualan tidak bisa dihapus.
    await expectCode(env.menuService.deleteMenu(nasiGoreng.id), "MENU_IN_USE");
    await env.menuService.setActive(nasiGoreng.id, false);
    await expectCode(env.menuService.postSale(sale("2026-01-30", [{ menu: nasiGoreng, portions: 1 }])), "MENU_INACTIVE");
  });

  it("variance per bahan: theoretical (porsi × resep berlaku × harga opname) vs actual (COGS)", async () => {
    await env.menuService.postSale(sale("2026-01-15", [{ menu: nasiGoreng, portions: 20 }, { menu: telurDadar, portions: 4 }]));
    await env.menuService.postSale(sale("2026-01-25", [{ menu: nasiGoreng, portions: 30 }, { menu: telurDadar, portions: 5 }]));
    await env.menuService.postSale(sale("2026-01-27", [{ menu: nasiGoreng, portions: 99 }]));
    await env.menuService.createPortionSummary({ workspaceId, dateFrom: "2026-01-26", dateTo: "2026-01-28", note: null, lines: [{ menuId: nasiGoreng.id, portions: 10 }, { menuId: telurDadar.id, portions: 3 }] });
    const { count } = await env.stockCountService.post(workspaceId, "2026-01-31", new Map([[ayam.id, 4_000], [beras.id, 10_000], [telur.id, 40]]));

    const analysis = await env.menuService.variance(workspaceId, count.id);
    expect(analysis.rows.map((r) => [r.item.name, Number(r.theoretical.qty.n) / Number(r.theoretical.qty.d), r.theoretical.value, r.actual.qty, r.actual.value, r.variance.value])).toEqual([
      ["Beras", 9_000, 135_000, 10_000, 150_000, 15_000],
      ["Ayam", 6_800, 340_000, 6_000, 300_000, -40_000],
      ["Telur", 68, 136_000, 60, 120_000, -16_000],
    ]);
    expect(analysis.totals).toEqual({ theoretical: 611_000, actual: 570_000, variance: -41_000 });
    expect(analysis.rows.find((r) => r.item.id === beras.id)!.ratio).toBeCloseTo(15_000 / 135_000);
    expect(analysis.menus.map((m) => [m.menu?.name, m.portions, m.summaryPortions, m.salePortions, m.noRecipePortions, m.cost])).toEqual([
      ["Nasi Goreng", 60, 10, 50, 0, 595_000],
      ["Telur Dadar", 12, 3, 9, 0, 16_000],
    ]);
    expect(analysis.warnings).toEqual([]);
  });

  it("menu tanpa resep berlaku dilaporkan; pecahan dibulatkan sekali ke rupiah", async () => {
    const kopi = await env.menuService.createMenu(workspaceId, { code: "M-03", name: "Kopi", category: "Minuman", price: 15_000, revenueAccountId: byCode("4-2000").id });
    await env.menuService.postSale(sale("2026-01-15", [{ menu: kopi, portions: 7 }, { menu: telurDadar, portions: 4 }]));
    const { count } = await env.stockCountService.post(workspaceId, "2026-01-31", new Map([[ayam.id, 10_000], [beras.id, 20_000], [telur.id, 97]]));
    const analysis = await env.menuService.variance(workspaceId, count.id);
    // Telur Dadar 4 porsi × 2/3 = 8/3 butir × Rp 2.000 = 5.333,33 → 5.333.
    expect(analysis.rows.find((r) => r.item.id === telur.id)!.theoretical.value).toBe(5_333);
    expect(analysis.warnings).toEqual(["Kopi: 7 porsi tanpa resep berlaku (tidak masuk theoretical)"]);
    expect(fractionValue({ n: BigInt(1), d: BigInt(2) }, { qty: 1, value: 3 })).toBe(2);
  });

  it("template rekap porsi: urut kategori, bolak-balik CSV, kode tak dikenal", async () => {
    const kopi = await env.menuService.createMenu(workspaceId, { code: "B-01", name: "Kopi", category: "Minuman", price: 15_000, revenueAccountId: byCode("4-2000").id });
    const menus = await env.repos.menus.listMenus(workspaceId);
    const rows = portionSheetRows(menus, new Map([[nasiGoreng.id, 40]]));
    expect(rows.map((r) => r[0])).toEqual(["Kode Menu", "M-01", "M-02", "B-01"]);
    expect(rows[1]).toEqual(["M-01", "Nasi Goreng", "Makanan", 40]);
    expect([...parsePortionSheet(parseCsv(toCsv(rows)), menus).quantities]).toEqual([[nasiGoreng.id, 40]]);
    const edited = parsePortionSheet(parseCsv("Kode Menu;Nama Menu;Kategori;Porsi\r\nb-01;Kopi;Minuman;1.200\r\nZZ;Asing;;3\r\n"), menus);
    expect([...edited.quantities]).toEqual([[kopi.id, 1_200]]);
    expect(edited.unknownCodes).toEqual(["ZZ"]);
  });

  it("laporan per menu: porsi, pendapatan (aktual + estimasi rekap), biaya bahan per akhir periode, margin", async () => {
    // Penjualan 15 Jan: NG 20 (500.000) & TD 4 (40.000); 25 Jan: NG 30 (750.000) & TD 5 (50.000);
    // rekap 26–28 Jan: NG 10 & TD 3 → estimasi 10 × 25.000 = 250.000 dan 3 × 10.000 = 30.000; penjualan 27 Jan NG 99 diabaikan.
    // Harga per 31 Jan (rata-rata pembelian): Ayam 50, Beras 15, Telur 2.000.
    // NG: Ayam 20×100 + 40×120 = 6.800 g (340.000), Beras 60×150 = 9.000 g (135.000), Telur 60 (120.000) → 595.000.
    // TD: Telur 12 × 2/3 = 8 → 16.000.
    await env.menuService.postSale(sale("2026-01-15", [{ menu: nasiGoreng, portions: 20 }, { menu: telurDadar, portions: 4 }]));
    await env.menuService.postSale(sale("2026-01-25", [{ menu: nasiGoreng, portions: 30 }, { menu: telurDadar, portions: 5 }]));
    await env.menuService.postSale(sale("2026-01-27", [{ menu: nasiGoreng, portions: 99 }]));
    await env.menuService.createPortionSummary({ workspaceId, dateFrom: "2026-01-26", dateTo: "2026-01-28", note: null, lines: [{ menuId: nasiGoreng.id, portions: 10 }, { menuId: telurDadar.id, portions: 3 }] });
    const ctx = await env.menuService.context(workspaceId);
    const report = menuReport(ctx, "2026-01-01", "2026-01-31", { valuation: "average", tax: null });
    expect(report.rows.map((r) => [r.menu?.name, r.portions, r.salePortions, r.summaryPortions, r.revenue, r.estimatedRevenue, r.cost, r.margin])).toEqual([
      ["Nasi Goreng", 60, 50, 10, 1_500_000, 250_000, 595_000, 905_000],
      ["Telur Dadar", 12, 9, 3, 120_000, 30_000, 16_000, 104_000],
    ]);
    expect(report.totals).toEqual({ portions: 72, revenue: 1_620_000, estimatedRevenue: 280_000, cost: 611_000, margin: 1_009_000 });
    expect(report.warnings).toEqual([]);

    // Periode 16–31 Jan: penjualan 15 Jan keluar; NG 40 porsi resep v2.
    const late = menuReport(ctx, "2026-01-16", "2026-01-31", { valuation: "average", tax: null });
    expect(late.rows[0]).toMatchObject({ portions: 40, revenue: 1_000_000, cost: 410_000 });

    // Pajak termasuk: pendapatan penjualan diambil dari jurnal (tanpa pajak), estimasi rekap dikurangi pajak.
    const withTax = await env.menuService.postSale(sale("2026-02-02", [{ menu: nasiGoreng, portions: 1 }], { applyTax: true, tax: { rateBps: 1000, inclusive: true } }));
    expect(withTax).toBeTruthy();
    await env.menuService.createPortionSummary({ workspaceId, dateFrom: "2026-02-03", dateTo: "2026-02-04", note: null, lines: [{ menuId: nasiGoreng.id, portions: 2 }] });
    const feb = menuReport(await env.menuService.context(workspaceId), "2026-02-01", "2026-02-28", { valuation: "average", tax: { rateBps: 1000, inclusive: true } });
    // 25.000 termasuk PB1 → 22.727; rekap 2 × 25.000 = 50.000 termasuk PB1 → 45.455.
    expect(feb.rows[0]).toMatchObject({ portions: 3, revenue: 22_727 + 45_455, estimatedRevenue: 45_455 });
  });
});
