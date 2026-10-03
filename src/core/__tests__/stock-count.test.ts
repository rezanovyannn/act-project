/**
 * Stok opname sisa bahan & COGS (ADR 020). Angka harapan dihitung manual:
 *
 * Januari: beli Ayam 10.000 g Rp 500.000 (Rp 50/g), Beras 20.000 g Rp 300.000 (Rp 15/g).
 * Opname 31 Jan (rata-rata): Ayam sisa 2.000 g = 2.000 × 50 = 100.000; Beras sisa 5.000 g = 75.000.
 *   COGS = 0 + 800.000 − 175.000 = 625.000 = penyesuaian (buku 800.000 − fisik 175.000).
 * Februari: beli Ayam 8.000 g Rp 480.000 (Rp 60/g) dan 2.000 g Rp 130.000 (Rp 65/g).
 * Opname 28 Feb (rata-rata): Ayam (100.000 + 610.000) ÷ (2.000 + 10.000) g × 3.000 g = 177.500;
 *   Beras 75.000 ÷ 5.000 × 1.000 = 15.000. COGS Ayam 532.500, Beras 60.000, total 592.500
 *   = penyesuaian (buku 175.000 + 610.000 − fisik 192.500).
 * Harga beli terakhir: Ayam 3.000 × 65 = 195.000; Beras (pembelian terakhir Jan) 1.000 × 15 = 15.000.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { AccountingError, type ValidationCode } from "@/core/errors";
import { buildStockCount, compareBySection, rowsOfSavedCount, sumRows, type CountContext } from "@/core/stock-count";
import { countSheetRows, parseCountSheet, parseCsv } from "@/core/stock-count-sheet";
import { toCsv } from "@/core/backup";
import type { Account, Item, StockCount } from "@/core/types";
import { createFnbWorkspace, createTestEnv } from "./helpers";

function expectCode(fn: () => unknown, code: ValidationCode) {
  let error: unknown = null;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(AccountingError);
  expect((error as AccountingError).issues.map((i) => i.code)).toContain(code);
}

describe("stok opname sisa bahan & COGS", () => {
  let env: ReturnType<typeof createTestEnv>;
  let workspaceId: string;
  let accounts: Account[];
  let ayam: Item;
  let beras: Item;
  let garam: Item;
  const byCode = (code: string) => accounts.find((a) => a.code === code)!;
  const counts: StockCount[] = [];

  async function buy(date: string, item: Item, qty: number, value: number) {
    return env.journalService.postJournal({
      workspaceId,
      entryDate: date,
      description: `Beli ${item.name}`,
      source: "purchase",
      lines: [
        { accountId: byCode("1-1300").id, debit: value, credit: 0, itemId: item.id, quantity: qty },
        { accountId: byCode("1-1100").id, debit: 0, credit: value },
      ],
    });
  }
  async function context(): Promise<CountContext> {
    return {
      items: await env.repos.items.listByWorkspace(workspaceId),
      accounts,
      entries: await env.repos.journals.listByWorkspace(workspaceId),
      counts,
    };
  }
  function save(plan: ReturnType<typeof buildStockCount>): StockCount {
    const count = { ...plan.count, id: `count-${counts.length + 1}`, journalEntryId: null, createdAt: "" };
    counts.push(count);
    return count;
  }

  beforeEach(async () => {
    counts.length = 0;
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
    beras = await env.itemService.createItem(workspaceId, { code: "D-01", name: "Beras", unit: "gram", revenueAccountId: null, category: "Dry Goods" });
    garam = await env.itemService.createItem(workspaceId, { code: "X-01", name: "Garam", unit: "gram", revenueAccountId: null });
    await buy("2026-01-10", ayam, 10_000, 500_000);
    await buy("2026-01-10", beras, 20_000, 300_000);
  });

  it("urut per section (abjad, tanpa section terakhir) lalu kode", () => {
    expect([garam, ayam, beras].sort(compareBySection).map((i) => i.name)).toEqual(["Beras", "Ayam", "Garam"]);
  });

  it("opname pertama: COGS = awal + beli − akhir, jurnal penyesuaian sama dengan total COGS", async () => {
    const plan = buildStockCount(await context(), {
      workspaceId,
      countDate: "2026-01-31",
      valuation: "average",
      quantities: new Map([[ayam.id, 2_000], [beras.id, 5_000], [garam.id, 0]]),
    });
    const ayamRow = plan.rows.find((r) => r.item.id === ayam.id)!;
    expect(ayamRow).toMatchObject({ begin: { qty: 0, value: 0 }, purchase: { qty: 10_000, value: 500_000 }, end: { qty: 2_000, value: 100_000 }, cogs: { qty: 8_000, value: 400_000 } });
    expect(sumRows(plan.rows)).toEqual({ begin: 0, purchase: 800_000, end: 175_000, cogs: 625_000 });
    expect(plan.bookBalance).toBe(800_000);
    expect(plan.unitemizedDifference).toBe(0);
    expect(plan.journal!.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      [byCode("5-1000").id, 625_000, 0],
      [byCode("1-1300").id, 0, 625_000],
    ]);
  });

  it("opname kedua: stok awal dari opname sebelumnya, rata-rata & harga terakhir", async () => {
    const first = buildStockCount(await context(), { workspaceId, countDate: "2026-01-31", valuation: "average", quantities: new Map([[ayam.id, 2_000], [beras.id, 5_000], [garam.id, 0]]) });
    await env.journalService.postJournal(first.journal!);
    save(first);
    await buy("2026-02-05", ayam, 8_000, 480_000);
    await buy("2026-02-20", ayam, 2_000, 130_000);
    const quantities = new Map([[ayam.id, 3_000], [beras.id, 1_000], [garam.id, 0]]);

    const avg = buildStockCount(await context(), { workspaceId, countDate: "2026-02-28", valuation: "average", quantities });
    expect(avg.rows.map((r) => [r.item.name, r.begin.value, r.purchase.value, r.end.value, r.cogs.value])).toEqual([
      ["Beras", 75_000, 0, 15_000, 60_000],
      ["Ayam", 100_000, 610_000, 177_500, 532_500],
      ["Garam", 0, 0, 0, 0],
    ]);
    expect(avg.bookBalance).toBe(785_000);
    expect(avg.journal!.lines[0]).toMatchObject({ debit: 592_500 });
    expect(avg.unitemizedDifference).toBe(0);

    const last = buildStockCount(await context(), { workspaceId, countDate: "2026-02-28", valuation: "last", quantities });
    expect(last.rows.find((r) => r.item.id === ayam.id)!.end.value).toBe(195_000);
    expect(last.rows.find((r) => r.item.id === beras.id)!.end.value).toBe(15_000);

    // Tab COGS dari stok opname tersimpan = perhitungan saat disimpan.
    const saved = save(avg);
    expect(sumRows(rowsOfSavedCount(await context(), saved))).toEqual(sumRows(avg.rows));
  });

  it("void pembelian ikut terhitung & harga terakhir kembali ke pembelian sebelumnya", async () => {
    await buy("2026-01-15", ayam, 1_000, 70_000);
    const late = await buy("2026-01-20", ayam, 1_000, 90_000);
    await env.journalService.voidJournal(late.id, "2026-01-21");
    const plan = buildStockCount(await context(), { workspaceId, countDate: "2026-01-31", valuation: "last", quantities: new Map([[ayam.id, 1_000], [beras.id, 0], [garam.id, 0]]) });
    const row = plan.rows.find((r) => r.item.id === ayam.id)!;
    expect(row.purchase).toEqual({ qty: 11_000, value: 570_000 });
    expect(row.end.value).toBe(70_000);
  });

  it("validasi: qty wajib & bulat, tanggal setelah opname terakhir, bahan tanpa harga", async () => {
    const ctx = await context();
    expectCode(() => buildStockCount(ctx, { workspaceId, countDate: "2026-01-31", valuation: "average", quantities: new Map([[ayam.id, 1]]) }), "INVALID_QUANTITY");
    expectCode(() => buildStockCount(ctx, { workspaceId, countDate: "2026-01-31", valuation: "average", quantities: new Map([[ayam.id, 1.5], [beras.id, 0], [garam.id, 0]]) }), "INVALID_QUANTITY");
    const plan = buildStockCount(ctx, { workspaceId, countDate: "2026-01-31", valuation: "average", quantities: new Map([[ayam.id, 0], [beras.id, 0], [garam.id, 500]]) });
    expect(plan.rows.find((r) => r.item.id === garam.id)).toMatchObject({ noCost: true, end: { qty: 500, value: 0 } });
    save(plan);
    expectCode(() => buildStockCount({ ...ctx, counts }, { workspaceId, countDate: "2026-01-31", valuation: "average", quantities: new Map() }), "INVALID_STOCK_COUNT");
  });

  it("template & import: bolak-balik CSV, kode tak dikenal, qty tidak valid, pemisah ribuan, titik koma", async () => {
    const items = await env.repos.items.listByWorkspace(workspaceId);
    const rows = countSheetRows(items, new Map([[ayam.id, 2_500]]));
    expect(rows[0]).toEqual(["Kode", "Nama Bahan", "Section", "Satuan", "Qty Sisa"]);
    expect(rows.slice(1).map((r) => r[0])).toEqual(["D-01", "P-01", "X-01"]);
    const back = parseCountSheet(parseCsv(toCsv(rows)), items);
    expect([...back.quantities]).toEqual([[ayam.id, 2_500]]);

    const edited = parseCountSheet(
      parseCsv("Kode;Nama Bahan;Section;Satuan;Qty Sisa\r\nD-01;Beras;Dry Goods;gram;1.250\r\nP-01;Ayam;Protein;gram;1,5\r\nZZ-9;Asing;;gram;3\r\nX-01;Garam;;gram;\r\n"),
      items,
    );
    expect([...edited.quantities]).toEqual([[beras.id, 1_250]]);
    expect(edited.invalid).toEqual([{ code: "P-01", value: "1,5" }]);
    expect(edited.unknownCodes).toEqual(["ZZ-9"]);
    // Excel: angka sebagai number.
    expect([...parseCountSheet([["Kode", "Qty Sisa"], ["p-01", 42]], items).quantities]).toEqual([[ayam.id, 42]]);
  });
});
